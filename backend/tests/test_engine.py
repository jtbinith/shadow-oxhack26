from app.coach import engine
from app.coach.engine import Mastery, Rep


def test_elo_rises_after_a_good_rep_and_falls_after_a_bad_one():
    m = Mastery()
    assert engine.update(m, 0.5, 0.75, 95).rating > m.rating
    assert engine.update(m, 0.5, 0.75, 30).rating < m.rating


def test_two_passes_move_up_a_speed_tier():
    reps = [Rep(0.5, 85, True, "full", None), Rep(0.5, 88, True, "full", None)]
    assert engine.next_drill(0.5, Mastery(), reps, 0.5) == {"action": "practise", "speed": 0.75, "drill": "full", "reason": "Two passes in a row: up to 0.75×."}


def test_two_passes_at_full_speed_moves_on():
    reps = [Rep(1.0, 85, True, "full", None), Rep(1.0, 90, True, "full", None)]
    assert engine.next_drill(0.5, Mastery(), reps, 1.0)["action"] == "next_step"


def test_three_fails_on_the_arms_teach_the_same_move_arms_only():
    fault = {"type": "shape", "body_part": "right_arm"}
    reps = [Rep(0.75, 50, False, "full", fault)] * 3
    nxt = engine.next_drill(0.5, Mastery(), reps, 0.75)
    assert nxt["drill"] == "arms" and nxt["speed"] == 0.5


def test_three_timing_fails_slow_down():
    reps = [Rep(0.75, 50, False, "full", {"type": "late", "count": 3})] * 3
    assert engine.next_drill(0.5, Mastery(), reps, 0.75)["speed"] == 0.5


def test_sweet_spot_picks_a_speed_with_70_to_85_percent_pass_chance():
    m = Mastery(rating=1400)
    nxt = engine.next_drill(0.5, m, [], 0.75)
    p = engine.pass_chance(m.rating, 0.5, nxt["speed"])
    assert 0.7 <= p <= 0.85 or nxt["speed"] in (0.5, 1.0)


def test_spaced_repetition_pushes_reviews_out_after_passes():
    m = engine.update(Mastery(), 0.5, 1.0, 90)
    assert m.stability > 0.5 and engine.review_due_in_days(m) > 0
    assert engine.update(m, 0.5, 1.0, 40).stability < m.stability


def test_after_a_good_breakdown_drill_go_back_to_the_full_move():
    fault = {"type": "shape", "body_part": "right_arm"}
    reps = [Rep(0.75, 50, False, "full", fault)] * 3 + [Rep(0.5, 82, False, "arms", None)]
    assert engine.next_drill(0.5, Mastery(), reps, 0.5) == {"action": "practise", "speed": 0.5, "drill": "full", "reason": "Nice, now the full move again."}


def test_new_learner_on_average_move_at_half_speed_is_around_75_percent():
    assert 0.7 <= engine.pass_chance(1000, 0.5, 0.5) <= 0.8
