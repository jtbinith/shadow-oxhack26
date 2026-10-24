`osnet_x0_25_msmt17.onnx`: OSNet x0.25 person re-identification model trained on MSMT17.
Source: https://huggingface.co/anriha/osnet_x0_25_msmt17 (MIT licence; original OSNet by Kaiyang Zhou, MIT).
Changed: batch dimension made dynamic (was fixed at 16). Input [N, 3, 256, 128] RGB, ImageNet-normalised; output [N, 512].
