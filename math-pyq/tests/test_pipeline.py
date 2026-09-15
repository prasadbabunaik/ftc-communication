#!/usr/bin/env python3
"""
End-to-end test of the extract -> classify -> aggregate pipeline.

The fixture reproduces the *layout* of a UPSC Mathematics paper (section
headers, Q1-Q8, lettered parts, right-margin marks, boilerplate noise) with
representative question prose. It is a layout fixture, not a reproduction of
any actual exam paper.
"""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from extract_questions import parse_pages          # noqa: E402
from classify import Classifier, load_taxonomy     # noqa: E402
from build_dataset import build, infer_marks, quality  # noqa: E402

PAPER_I = """
QUESTION PAPER SPECIFIC INSTRUCTIONS
Please read each of the following instructions carefully before attempting questions.
There are EIGHT questions divided in TWO SECTIONS and printed both in HINDI and in ENGLISH.
Candidate has to attempt FIVE questions in all.
Question Nos. 1 and 5 are compulsory.
SECTION 'A'
Q1. (a) Let V be the vector space of all 2x2 matrices over R. Find a basis and the dimension of V. 10
(b) Evaluate the limit and examine continuity and differentiability of the function at the origin. 10
(c) Find the shortest distance between the two skew lines given below. 10
(d) Find the eigenvalues and eigenvectors of the given matrix. 10
(e) Evaluate the double integral over the region bounded by the curves. 10
Q2. (a) Using the Cayley-Hamilton theorem, find the eigenvalues and the characteristic polynomial. 15
(b) Reduce the quadratic form to canonical form and find its signature and index. 15
(c) Verify the rank-nullity theorem for the given linear transformation. 20
Q3. (a) Find the maxima and minima using Lagrange's method of multipliers. 15
(b) Change the order of integration in the double integral and evaluate it. 20
(c) Trace the curve and find its asymptotes. 15
Q4. (a) Find the equation of the sphere passing through the given circle. 15
(b) Show that the cone and the cylinder intersect in the given curve. 15
(c) Reduce the second degree equation to canonical form and identify the conicoid. 20
SECTION 'B'
Q5. (a) Solve the Clairaut's equation and find its singular solution. 10
(b) Find the Laplace transform of the given function. 10
(c) Discuss the simple harmonic motion of the particle. 10
(d) A particle moves under a central force; find the orbit. 10
(e) Verify Stokes theorem for the given vector field over the surface. 10
Q6. (a) Solve the second order linear equation with constant coefficients. 15
(b) Use the method of variation of parameters when one solution is known. 15
(c) Apply the inverse Laplace transform to the initial value problem. 20
Q7. (a) A projectile is fired; find the horizontal range and angle of projection. 15
(b) Discuss the stability of equilibrium and the effect of friction. 20
(c) Find the common catenary using the principle of virtual work. 15
Q8. (a) Find the curvature and torsion using Serret-Frenet formulae. 20
(b) Apply the divergence theorem to evaluate the surface integral. 15
(c) Show that the vector field is solenoidal and find its curl. 15
"""

PAPER_II = """
SECTION 'A'
Q1. (a) Show that a group of prime order is cyclic using Lagrange's theorem. 10
(b) Prove that every Cauchy sequence of real numbers is convergent. 10
(c) Show that the function satisfies the Cauchy-Riemann equations and is analytic. 10
(d) Solve the linear programming problem by the graphical method. 10
(e) Test the convergence of the improper integral. 10
Q2. (a) Prove the first isomorphism theorem for a homomorphism of groups. 15
(b) Show that every Euclidean domain is a principal ideal domain. 20
(c) Prove that a finite integral domain is a field. 15
Q3. (a) Test the series for absolute convergence and conditional convergence. 15
(b) Show that the sequence of functions is uniformly convergent. 20
(c) Prove that a continuous function on a compact set is uniformly continuous. 15
Q4. (a) Find the Laurent series and classify the singularities. 20
(b) Evaluate the real integral by contour integration using the residue theorem. 15
(c) Solve the transportation problem by Vogel's approximation method. 15
SECTION 'B'
Q5. (a) Reduce the second order partial differential equation to canonical form. 10
(b) Solve the one dimensional heat equation by separation of variables. 10
(c) Find a real root by the Newton-Raphson method correct to three decimal places. 10
(d) Convert the decimal number to binary and hexadecimal. 10
(e) Write the Lagrange's equations using generalised coordinates. 10
Q6. (a) Use Cauchy's method of characteristics for the quasilinear equation. 20
(b) Solve the vibrating string problem with the given boundary conditions. 15
(c) Solve the Laplace equation in the rectangular region. 15
Q7. (a) Apply Simpson's rule and the trapezoidal rule for numerical integration. 15
(b) Solve the system by the Gauss-Seidel iterative method. 15
(c) Use the Runge-Kutta method of fourth order with the given step size. 20
Q8. (a) Find the moment of inertia of the rigid body about the principal axes. 15
(b) Derive the equation of continuity and find the stream function. 20
(c) Write the Navier-Stokes equation for a viscous fluid. 15
"""


class TestExtraction(unittest.TestCase):
    def setUp(self):
        self.p1 = parse_pages([(1, PAPER_I)], 2023, "I")
        self.p2 = parse_pages([(1, PAPER_II)], 2023, "II")

    def test_all_parts_found(self):
        # 2 compulsory x 5 parts + 6 questions x 3 parts = 28 per paper
        self.assertEqual(len(self.p1), 28, [q["id"] for q in self.p1])
        self.assertEqual(len(self.p2), 28, [q["id"] for q in self.p2])

    def test_boilerplate_excluded(self):
        joined = " ".join(q["text"] for q in self.p1).lower()
        self.assertNotIn("candidate has to attempt", joined)
        self.assertNotIn("question paper specific", joined)

    def test_sections_and_compulsory(self):
        self.assertTrue(all(q["section"] == "A" for q in self.p1 if q["question_no"] <= 4))
        self.assertTrue(all(q["section"] == "B" for q in self.p1 if q["question_no"] >= 5))
        comp = [q for q in self.p1 if q["compulsory"]]
        self.assertEqual(len(comp), 10)
        self.assertTrue(all(q["question_no"] in (1, 5) for q in comp))

    def test_marks_parsed_total_400_printed(self):
        # A paper prints 8 x 50 = 400 marks; a candidate attempts 5 x 50 = 250.
        self.assertEqual(sum(q["marks"] for q in self.p1), 400)
        self.assertEqual(sum(q["marks"] for q in self.p2), 400)

    def test_ids_unique(self):
        ids = [q["id"] for q in self.p1 + self.p2]
        self.assertEqual(len(ids), len(set(ids)))


class TestClassification(unittest.TestCase):
    def setUp(self):
        self.tax = load_taxonomy()
        self.clf = Classifier(self.tax)
        self.qs = parse_pages([(1, PAPER_I)], 2023, "I") + \
                  parse_pages([(1, PAPER_II)], 2023, "II")
        for q in self.qs:
            q.update(self.clf.classify(q["text"], q["paper"], q["section"]))

    def test_everything_classified(self):
        unclassified = [q["id"] for q in self.qs if not q["topic_id"]]
        self.assertEqual(unclassified, [])

    def test_topic_respects_paper_and_section(self):
        by_id = {t["id"]: t for t in self.tax["topics"]}
        for q in self.qs:
            t = by_id[q["topic_id"]]
            self.assertEqual(t["paper"], q["paper"], q["id"])
            self.assertEqual(t["section"], q["section"], q["id"])

    def test_known_questions_land_on_right_topic(self):
        expect = {
            "2023-PI-Q2a": "linear_algebra",
            "2023-PI-Q3a": "calculus",
            "2023-PI-Q4a": "analytic_geometry",
            "2023-PI-Q6a": "ordinary_differential_equations",
            "2023-PI-Q7a": "dynamics_and_statics",
            "2023-PI-Q8a": "vector_analysis",
            "2023-PII-Q2a": "algebra",
            "2023-PII-Q3a": "real_analysis",
            "2023-PII-Q4a": "complex_analysis",
            "2023-PII-Q4c": "linear_programming",
            "2023-PII-Q6a": "partial_differential_equations",
            "2023-PI-Q1e": "calculus",
            "2023-PII-Q1e": "real_analysis",
            "2023-PII-Q7a": "numerical_analysis_and_computer_programming",
            "2023-PII-Q8a": "mechanics_and_fluid_dynamics",
        }
        got = {q["id"]: q["topic_id"] for q in self.qs}
        for qid, want in expect.items():
            self.assertEqual(got.get(qid), want, f"{qid}: {got.get(qid)} != {want}")

    def test_all_thirteen_topics_covered(self):
        self.assertEqual(len({q["topic_id"] for q in self.qs}), 13)


class TestAggregation(unittest.TestCase):
    def setUp(self):
        self.tax = load_taxonomy()
        clf = Classifier(self.tax)
        self.qs = []
        for yr in (2022, 2023):
            for txt, pap in ((PAPER_I, "I"), (PAPER_II, "II")):
                recs = parse_pages([(1, txt)], yr, pap)
                for r in recs:
                    r.update(clf.classify(r["text"], r["paper"], r["section"]))
                self.qs.extend(recs)
        infer_marks(self.qs)
        self.a = build(self.qs, self.tax)

    def test_coverage(self):
        self.assertEqual(self.a["coverage"]["years"], [2022, 2023])
        self.assertEqual(self.a["coverage"]["total_marks"], 1600)
        self.assertEqual(self.a["coverage"]["question_parts"], 112)

    def test_topic_shares_sum_to_100(self):
        self.assertAlmostEqual(sum(t["share_pct"] for t in self.a["by_topic"]), 100.0, places=0)

    def test_topic_marks_reconcile(self):
        self.assertEqual(sum(t["marks"] for t in self.a["by_topic"]),
                         self.a["coverage"]["total_marks"])

    def test_topic_year_matrix_shape(self):
        for row in self.a["topic_year"]:
            self.assertEqual([p["year"] for p in row["series"]], [2022, 2023])

    def test_compulsory_split_reconciles(self):
        for t in self.a["by_topic"]:
            self.assertEqual(t["compulsory_marks"] + t["optional_marks"], t["marks"])

    def test_quality_report_clean(self):
        q = quality(self.qs, self.tax)
        self.assertEqual(q["unclassified"], 0)
        self.assertEqual(q["paper_marks_anomalies"], [])
        self.assertEqual(q["papers_missing"], [])

    def test_json_serialisable(self):
        json.dumps(self.a)


if __name__ == "__main__":
    unittest.main(verbosity=2)
