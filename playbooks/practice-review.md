# Practice review

Choose the next drill from the learner's state.

Inputs: mastery ratings per move, review schedule, error clusters, the last reps.

1. If a review is due, schedule it first.
2. Otherwise pick the drill whose predicted pass chance is **70–85%** (the sweet spot).
3. If the same move failed 3+ times, **teach that move** (never swap it for an easier one):
   key-pose freezes at 0.25× → the body part from the top error cluster on its own
   (legs only or arms only) → both together → back up the speed ladder.
4. Give a one-line reason the learner can read ("arms only: your elbow drops on 3 of your last 4 reps").
5. Output only the `next_drill` JSON schema.
