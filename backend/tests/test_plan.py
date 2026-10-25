import numpy as np
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
    beats = [i * 0.5 for i in range(16)]
    out = eight_counts(beats, beats[::4], duration=8.0)
    assert [(e["start"], e["end"]) for e in out] == [(0.0, 4.0), (4.0, 8.0)]
    assert out[0]["counts"] == [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]


def test_short_and_leftover_phrases_are_four_counts():
    beats = [i * 0.5 for i in range(12)]  # 8 + a leftover bar
    out = eight_counts(beats, beats[::4], duration=6.0)
    assert [len(e["counts"]) for e in out] == [8, 4]
    one_bar = eight_counts([0, 0.9, 1.8, 2.7], [0], duration=3.6)
    assert [len(e["counts"]) for e in one_bar] == [4]


def test_beat_from_movement_without_music():
    from app.pipeline.audio import motion_grid
    fps, bpm = 30, 80
    t = np.arange(12 * fps) / fps
    speed = np.maximum(0, np.sin(2 * np.pi * t * bpm / 60)) ** 4  # a burst of movement on every beat
    g = motion_grid(speed, fps, 12.0)
    assert len(g["beats"]) == 16 and abs(g["tempo"] - bpm) < 3
    assert g["source"] == "movement"
    # Standing still before and after isn't counted: ~2 s of dancing at 120 BPM in a 3.6 s clip = 4 counts.
    t = np.arange(int(3.6 * fps)) / fps
    burst = np.where((t > 0.5) & (t < 2.5), np.maximum(0, np.sin(2 * np.pi * t * 2)) ** 4, 0.0)
    short = motion_grid(burst, fps, 3.6)
    assert len(short["beats"]) == 4 and 0.3 < short["beats"][0] < 0.7 and abs(short["tempo"] - 120) < 15