from app.coach.clusters import cluster


def rep(type_, part=None, direction=None, count=3, passed=False):
    return {"passed": passed, "top_fault": {"type": type_, "body_part": part, "direction": direction, "count": count}}


def test_too_few_reps_gives_no_habits():
    assert cluster([rep("shape", "right_arm", "higher")] * 3) == []


def test_one_consistent_habit():
    reps = [rep("shape", "right_arm", "a touch higher", c) for c in (3, 4, 3, 4, 3)]
    habits = cluster(reps)
    assert len(habits) == 1
    assert habits[0]["label"] == "Right arm too low around counts 3–4"
    assert habits[0]["share"] == 1.0


def test_two_distinct_habits_are_separated():
    arm = [rep("shape", "right_arm", "higher", 3) for _ in range(5)]
    late = [rep("late", count=7) for _ in range(4)]
    habits = cluster(arm + late)
    labels = {h["label"] for h in habits}
    assert "Right arm too low around count 3" in labels
    assert "Late on the beat around count 7" in labels
    assert habits[0]["count"] == 5


def test_passed_reps_are_not_habits():
    reps = [rep("shape", "right_arm", "higher", passed=True)] * 10
    assert cluster(reps) == []


def test_one_stray_rep_does_not_change_the_label():
    reps = [rep("shape", "left_arm", "higher", c) for c in (3, 4, 3, 4)] + [rep("late", count=7)]
    assert cluster(reps)[0]["label"] == "Left arm too low around counts 3–4"
