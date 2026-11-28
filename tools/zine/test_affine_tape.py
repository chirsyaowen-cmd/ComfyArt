import unittest

from canvas_records import shape
from frame_geometry import compose, point, rotate_box
from layout_schema import check_design
from native_canvas import Spread


class AffineTapeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tape = {
            "id": "tape", "name": "Tape", "kind": "rect",
            "box": [18, -14, 94, 28], "rotation": -7,
            "fill": "#EDE4CF", "opacity": 0.9,
        }
        self.instance = {
            "id": "strip", "name": "Strip", "kind": "use", "component": "group",
            "matrix": [0.9587, -0.0502, 0.0504, 0.9612, 76.14, 31.75],
        }
        self.ids = ["shape:left", "shape:right"]
        self.spread = {"id": "spread", "name": "Page", "pageIds": self.ids, "layers": [self.instance]}
        self.design = {
            "slots": [], "components": [{"id": "group", "layers": [self.tape]}],
            "spreads": [self.spread],
        }

    async def test_import_uses_the_four_transformed_corners(self):
        class Assets:
            def paint(self, fill, bindings):
                return fill

        check_design(self.design, [("spread", self.ids)])
        store = {k: shape(k, "frame", "page:book", i + 1, 0, 0, {"w": 480, "h": 680})
                 for i, k in enumerate(self.ids)}
        await Spread(store, Assets(), self.spread, self.design, {}, self.ids).install()
        tape = store["shape:spread:0:strip:tape"]
        self.assertEqual(tape["parentId"], "shape:spread:0:strip")
        self.assertEqual(tape["opacity"], 0.9)
        props = tape["props"]
        self.assertEqual((props["kind"], props["fill"]), ("path", "#EDE4CF"))
        transform = compose(self.instance["matrix"], rotate_box(self.tape["box"], -7))
        path = props["d"].split()
        self.assertEqual(path[-1], "Z")
        for i, corner in enumerate([(18, -14), (112, -14), (112, 14), (18, 14)]):
            x, y = point(transform, *corner)
            self.assertAlmostEqual(tape["x"] + float(path[3*i+1]) * props["w"], x, places=6)
            self.assertAlmostEqual(tape["y"] + float(path[3*i+2]) * props["h"], y, places=6)

    def test_unsupported_transforms_are_identified_before_sealing(self):
        for layer, matrix in [
            ({"kind": "ellipse"}, self.instance["matrix"]),
            ({"kind": "rect", "radius": 4}, self.instance["matrix"]),
            ({"kind": "rect"}, [1, 1, 2, 2, 0, 0]),
        ]:
            with self.subTest(layer=layer, matrix=matrix):
                self.tape.update(layer)
                self.instance["matrix"] = matrix
                with self.assertRaisesRegex(ValueError, "spread/strip/tape"):
                    check_design(self.design, [("spread", self.ids)])
