# Swapping in Vultr later

The app image is the same one the Hugging Face Space runs. On a Vultr VM:

1. Firewall group: allow 443 and 80 from anywhere, 22 from your IP only. Nothing else.
2. Copy `docker-compose.vultr.yml`, `Caddyfile` and a `.env` to the VM (set `STORAGE_BACKEND=s3`
   and the `VULTR_S3_*` values for Object Storage).
3. `PUBLIC_HOSTNAME=<vm-ip>.sslip.io docker compose -f docker-compose.vultr.yml up -d`
4. Add the VM's IP to the Tiger Data IP allow-list.
