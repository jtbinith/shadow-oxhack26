from app.agent.plan import LessonPlan, Step, _valid, rule_based
from app.pipeline.audio import eight_counts


def ec(i, repeat_of=None, difficulty=0.5, visible=1.0):
    return {"index": i, "repeat_of": repeat_of, "difficulty": difficulty, "visible": visible, "key_moments": []}


def test_rules_chain_and_skip_repeats():
    plan = rule_based([ec(0), ec(1, difficulty=0.8), ec(2, repeat_of=0)])
    assert [(s.type, s.eight_counts) for s in plan.steps] == [("learn", [0]), ("learn", [1]), ("chain", [0, 1])]
    assert plan.steps[1].start_speed == 0.5  # hard 8-count starts slow


def test_rules_skip_mostly_invisible_eight_counts():
    plan = rule_based([ec(0), ec(1, visible=0.2)])
    assert all(1 not in s.eight_counts for s in plan.steps)


def test_validation_rejects_unknown_or_missing_eight_counts():
    ecs = [ec(0), ec(1)]
    ok = LessonPlan(steps=[Step(type="learn", eight_counts=[0], start_speed=0.5), Step(type="learn", eight_counts=[1], start_speed=0.5)])
    missing = LessonPlan(steps=[Step(type="learn", eight_counts=[0], start_speed=0.5)])
    unknown = LessonPlan(steps=[Step(type="learn", eight_counts=[0, 1, 7], start_speed=0.5)])
    assert _valid(ok, ecs) and not _valid(missing, ecs) and not _valid(unknown, ecs)


def test_eight_counts_from_downbeats():
    out = eight_counts([0.0, 2.0, 4.0, 6.0, 8.0], duration=8.0)
    assert [(e["start"], e["end"]) for e in out] == [(0.0, 4.0), (4.0, 8.0)]
    assert out[0]["counts"] == [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]
