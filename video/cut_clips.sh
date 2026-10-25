#!/usr/bin/env bash
# Cuts the screen recordings into the demo's clips, each timed to its narration line.
# Live-camera shots are real screencasts (never a video fed into the camera).
set -euo pipefail
cd "$(dirname "$0")/public/clips"
A="$HOME/Videos/Screencasts/Screencast from 2026-10-25 09-16-47.mp4"   # practice: full screen, crows, fix, carry on
V="$HOME/Videos/Screencasts/Screencast from 2026-10-25 09-24-49.mp4"   # hands-free voice coach
FIT="scale=1920:-2,pad=1920:1080:0:(1080-ih)/2:black,fps=30"
enc=(-an -c:v libx264 -crf 18 -pix_fmt yuv420p)

# practice: the ready screen (Start button, tracked live) then full screen count-in and flowing
ffmpeg -loglevel error -y -ss 0.5 -to 4.9 -i "$A" -ss 29.3 -to 34.8 -i "$A" -filter_complex "[0:v]$FIT,setpts=PTS-STARTPTS[a];[1:v]$FIT,setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0[v]" -map "[v]" "${enc[@]}" d_practice.mp4
# carry on: matched the pose, straight back into the count-in
ffmpeg -loglevel error -y -ss 52.3 -to 56.5 -i "$A" -vf "$FIT" "${enc[@]}" d_carryon.mp4
# voice: "please can we go slower" -> "Slowing to 0.25 times" -> counted back in
ffmpeg -loglevel error -y -ss 21.3 -to 30.4 -i "$V" -vf "$FIT" "${enc[@]}" d_voice.mp4
# upload: typing at normal speed, the processing wait 9x faster, then the lesson plan
ffmpeg -loglevel error -y -i upload.mp4 -filter_complex "[0:v]split=3[a][b][c];[a]trim=0:2.6,setpts=PTS-STARTPTS[s1];[b]trim=2.6:29,setpts=(PTS-STARTPTS)/9[s2];[c]trim=29,setpts=PTS-STARTPTS[s3];[s1][s2][s3]concat=n=3:v=1:a=0,fps=30[v]" -map "[v]" "${enc[@]}" d_upload.mp4
# progress: a little faster
ffmpeg -loglevel error -y -i progress.mp4 -vf "setpts=PTS/1.5,fps=30" "${enc[@]}" d_progress.mp4
for f in d_*.mp4 home.mp4 plan.mp4 crows.mp4; do echo "$f $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")"; done
# tracking: several people tracked at once, each with their own colour, YOU locked on (camera area only, 0.8x)
T="$HOME/Videos/Screencasts/Screencast from 2026-10-24 20-57-13.mp4"
ffmpeg -loglevel error -y -ss 18 -to 33.5 -i "$T" -vf "crop=1100:619:408:189,scale=1920:1080,setpts=PTS/0.8,fps=30" "${enc[@]}" d_tracking.mp4
