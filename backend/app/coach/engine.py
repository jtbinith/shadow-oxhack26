"""The learning engine: mastery (Elo), the sweet-spot drill choice, spaced repetition,
and "teach the move you're failing" breakdown drills. Pure functions, easy to test."""
import math
from dataclasses import dataclass

SPEEDS = [0.5, 0.75, 1.0]
PASS = 80.0
K = 32
SWEET_SPOT = (0.70, 0.85)


@dataclass
class Mastery:
    rating: float = 1000.0
    reps: int = 0
    passes: int = 0
    best_speed: float = 0.0
    stability: float = 0.5  # days


def drill_rating(difficulty: float, speed: float, drill: str = "full") -> float:
    """How hard a drill is, on the same scale as the learner's rating."""
    easier = {"full": 0, "freeze": -250, "arms": -150, "legs": -150, "half": -120}[drill]
    # Calibrated so a new learner (rating 1000) on an average 8-count at 0.5× has ~75% pass chance.
    return 610 + 400 * difficulty + 300 * (speed - 0.5) + easier


def pass_chance(rating: float, difficulty: float, speed: float, drill: str = "full") -> float:
    return 1 / (1 + 10 ** ((drill_rating(difficulty, speed, drill) - rating) / 400))


def update(m: Mastery, difficulty: float, speed: float, score: float, drill: str = "full") -> Mastery:
    """Elo: move the rating towards how the rep actually went (score/100) versus the prediction."""
    expected = pass_chance(m.rating, difficulty, speed, drill)
    # 40 or below counts as a miss, 80+ as a full pass, in between as partial credit.
    outcome = min(1.0, max(0.0, (score - 40) / (PASS - 40)))
    passed = score >= PASS and drill == "full"
    return Mastery(
        rating=m.rating + K * (outcome - expected),
        reps=m.reps + 1,
        passes=m.passes + (1 if passed else 0),
        best_speed=max(m.best_speed, speed) if passed else m.best_speed,
        # Spaced repetition: a pass at full speed pushes the next review further out; a fail brings it close.
        stability=min(30.0, m.stability * (2.5 if speed >= 1 else 1.5)) if passed else max(0.02, m.stability * 0.5),
    )


@dataclass
class Rep:
    speed: float
    score: float
    passed: bool
    drill: str
    top_fault: dict | None


def next_drill(difficulty: float, mastery: Mastery, recent: list[Rep], current_speed: float, habit: dict | None = None) -> dict:
    """Pick what to do next on this step.

    - Passed twice in a row at this speed: move up a speed tier, or move on when at full speed.
    - Failed the full move 3 times running: teach that move (never swap it for an easier one) with a
      breakdown drill aimed at the biggest problem: freeze on key poses if the shapes are wrong,
      or isolate the body part that keeps going wrong.
    - Otherwise: the speed whose predicted pass chance sits in the 70–85% sweet spot.
    """
    full = [r for r in recent if r.drill == "full"]
    if len(full) >= 2 and full[-1].passed and full[-2].passed and full[-1].speed == full[-2].speed:
        if full[-1].speed >= 1.0:
            return {"action": "next_step", "reason": "Two clean reps at full speed. On to the next step!"}
        up = SPEEDS[SPEEDS.index(full[-1].speed) + 1]
        return {"action": "practise", "speed": up, "drill": "full", "reason": f"Two passes in a row: up to {up}×."}

    # After a breakdown drill that went well, go back to the full move.
    if recent and recent[-1].drill != "full" and recent[-1].score >= 70:
        return {"action": "practise", "speed": 0.5, "drill": "full", "reason": "Nice, now the full move again."}

    # 4+ fails even after a breakdown: drill just half of the 8-count.
    if len(full) >= 4 and not any(r.passed for r in full[-4:]) and any(r.drill != "full" for r in recent):
        return {"action": "practise", "speed": 0.5, "drill": "half", "reason": "Just the toughest half for a moment, then we'll stitch it back."}

    if len(full) >= 3 and not any(r.passed for r in full[-3:]) and (not recent or recent[-1].drill == "full"):
        # A clustered habit beats the last rep's fault: drill what keeps going wrong.
        fault = (habit or {}).get("fault") or full[-1].top_fault or {}
        part = fault.get("body_part", "")
        if fault.get("type") in ("late", "early"):
            return {"action": "practise", "speed": 0.5, "drill": "full", "reason": "Let's slow it right down and lock in the timing."}
        why = f" ({habit['label'].lower()})" if habit else ""
        if any(k in part for k in ("arm", "elbow", "wrist", "hand", "shoulder")):
            return {"action": "practise", "speed": 0.5, "drill": "arms", "reason": f"Arms only for a moment: your {part.replace('_', ' ')} keeps slipping{why}."}
        if any(k in part for k in ("leg", "knee", "ankle", "foot", "hip", "thigh", "shin")):
            return {"action": "practise", "speed": 0.5, "drill": "legs", "reason": f"Legs only for a moment: your {part.replace('_', ' ')} keeps slipping{why}."}
        return {"action": "practise", "speed": 0.5, "drill": "freeze", "reason": "Let's hold each key shape first, then put it back together."}

    candidates = [(s, pass_chance(mastery.rating, difficulty, s)) for s in SPEEDS]
    in_spot = [s for s, p in candidates if SWEET_SPOT[0] <= p <= SWEET_SPOT[1]]
    if in_spot:
        speed = max(in_spot)
    else:
        # Too hard everywhere → slowest; too easy everywhere → fastest.
        speed = SPEEDS[0] if all(p < SWEET_SPOT[0] for _, p in candidates) else SPEEDS[-1]
    speed = min(speed, max(current_speed, 0.5) + 0.25)  # never jump more than one tier
    chance = round(100 * pass_chance(mastery.rating, difficulty, speed))
    if SWEET_SPOT[0] * 100 <= chance <= SWEET_SPOT[1] * 100:
        reason = f"{chance}% chance of nailing it at {speed}×: the sweet spot."
    elif chance < SWEET_SPOT[0] * 100:
        reason = f"Keep building it at {speed}×."
    else:
        reason = f"You've got this at {speed}×. Make it clean."
    return {"action": "practise", "speed": speed, "drill": "full", "reason": reason}


def review_due_in_days(m: Mastery) -> float:
    return m.stability if m.passes else 0.0


def logistic(x: float) -> float:
    return 1 / (1 + math.exp(-x))
