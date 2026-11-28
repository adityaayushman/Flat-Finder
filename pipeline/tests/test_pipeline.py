"""Run with: python -m unittest discover -s tests   (from the pipeline folder)"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import build
import mb
import osm

PAGE = "<script>window.SERVER_PRELOADED_STATE_ = " + json.dumps({
    "projectDetailData": {
        "mUnitInfo": "2 , 10002 , 1245  Sq-ft  | 3 , 10002 , 1740  Sq-ft ",
        "prjMobileBean": {
            "sellCountProperty": "13", "rentCountProperty": "7",
            "infoBean": {"psmLatitude": "12.89", "psmLongitude": "80.22", "localityName": "Sholinganallur", "devName": "Dev Co",
                         "minSalePrice": 10340000, "maxSalePrice": 14680000},
            "detailBean": {"rate": "8210 - 10345", "projArea": "7 Acre", "status": "Ready To Move", "units": "507", "propType": "Multistorey Apartment"},
            "amenitiesList": [{"amenityName": "Swimming Pool", "isExists": "true"}, {"amenityName": "Spa", "isExists": "false"}],
            "ratingBean": {"psmAvgRt": 4.5, "totalReview": "6"},
        }}}) + ";</script>"


class ParseTests(unittest.TestCase):
    def test_project_page_reads_facts(self):
        r = mb.project_page(PAGE)
        self.assertEqual((r["lat"], r["lng"]), (12.89, 80.22))
        self.assertEqual(r["units"], [{"bhk": 2, "sqft": 1245.0}, {"bhk": 3, "sqft": 1740.0}])
        self.assertEqual((r["psf_low"], r["psf_high"], r["acres"]), (8210.0, 10345.0, 7.0))
        self.assertEqual(r["amenities"], ["Swimming Pool"])
        self.assertEqual((r["listings_sale"], r["rating_n"]), (13, 6))

    def test_missing_state_gives_empty_facts_not_a_crash(self):
        self.assertIsNone(mb.project_page("<html></html>")["lat"])

    def test_list_page(self):
        html = "x = " + "window.SERVER_PRELOADED_STATE_ = " + json.dumps({"searchAdditionalDataBean": {"totalCount": 41}, "searchResult": [{"psmid": "1"}]})
        self.assertEqual(mb.list_page(html), (41, [{"psmid": "1"}]))


class BuildTests(unittest.TestCase):
    def test_kind(self):
        self.assertEqual(build.kind_of({"ptype": "Villa"}), "villa")
        self.assertEqual(build.kind_of({"ptype": "Multistorey Apartment, Villa"}), "apartment")
        self.assertEqual(build.kind_of({"ptype": "Residential Plot"}), "plot")

    def test_bedroom_estimate_grows_with_size(self):
        self.assertLess(build.bedroom_estimate(900, 2)["s"], build.bedroom_estimate(2400, 3)["s"])

    def test_buy_estimate_stays_near_listed_range(self):
        row = {"sale_min": 10_000_000, "sale_max": 14_000_000}
        self.assertEqual(build.buy_estimate(2000, 20000, row), 16_800_000)  # capped at 1.2 x max

    def test_society_skips_projects_without_coordinates(self):
        pois = build.PoiIndex([])
        self.assertIsNone(build.society({"id": "1", "name": "A"}, pois))

    def test_society_prices_are_flagged_estimates(self):
        row = {"id": "1", "name": "A", "lat": 12.9, "lng": 80.2, "psf_low": 8000, "psf_high": 10000, "units": [{"bhk": 3, "sqft": 1500}], "amenities": ["Gymnasium"]}
        s = build.society(row, build.PoiIndex([{"k": "park", "lng": 80.2, "lat": 12.9, "name": None}]))
        self.assertEqual(s["pr"]["3"]["buy"][1], 1)
        self.assertIn("gym", s["am"])
        self.assertLess(s["nr"]["park"], 5)

    def test_nearest_poi_distance(self):
        idx = build.PoiIndex([{"k": "school", "lng": 80.21, "lat": 12.9, "name": None}])
        d = idx.nearest("school", 80.2, 12.9)
        self.assertTrue(900 < d < 1200)
        self.assertIsNone(idx.nearest("hospital", 80.2, 12.9))


class OsmTests(unittest.TestCase):
    def test_kinds(self):
        els = [{"lat": 1, "lon": 2, "tags": {"railway": "station", "name": "X"}}, {"center": {"lat": 1, "lon": 2}, "tags": {"leisure": "park"}}, {"lat": 1, "lon": 2, "tags": {"shop": "kiosk"}}]
        self.assertEqual([p["k"] for p in osm.parse(els)], ["rail", "park"])


if __name__ == "__main__":
    unittest.main()
