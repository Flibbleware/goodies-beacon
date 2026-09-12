#!/usr/bin/env bash
#
# Prepares a fresh Ubuntu droplet to run Goodies Beacon: a deploy user that can use Docker
# without sudo, Docker Engine and Compose from Docker's own apt repository, and a swap file.
#
# Safe to run again. Every step checks for its own result first, so a second run reports what is
# already in place and changes nothing — which is what makes it usable after a partial failure.
#
#   curl -fsSL https://raw.githubusercontent.com/Flibbleware/goodies-beacon/main/scripts/bootstrap-droplet.sh | sudo bash
#
# or, from a clone:
#
#   sudo ./scripts/bootstrap-droplet.sh

set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
SWAP_FILE="${SWAP_FILE:-/swapfile}"
SWAP_SIZE_MB="${SWAP_SIZE_MB:-2048}"
APP_DIR="${APP_DIR:-/opt/goodies-beacon}"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
ok() { printf '    \033[32m✓\033[0m %s\n' "$1"; }
already() { printf '    \033[2m·\033[0m %s\n' "$1"; }
fail() {
	printf '\n\033[31mError:\033[0m %s\n' "$1" >&2
	exit 1
}

[ "$(id -u)" -eq 0 ] || fail "run this with sudo."
command -v apt-get >/dev/null || fail "this expects a Debian or Ubuntu system (no apt-get found)."

# ---------------------------------------------------------------------------- deploy user
step "Deploy user ($DEPLOY_USER)"

if id "$DEPLOY_USER" >/dev/null 2>&1; then
	already "user exists"
else
	# useradd rather than adduser: it lives in passwd, which is on every system, while adduser is
	# a Debian convenience that minimal images leave out. No password is set, so the account has
	# no interactive login — it is reached by SSH key only.
	useradd --create-home --shell /bin/bash --comment 'Goodies Beacon deploy' "$DEPLOY_USER"
	usermod --lock "$DEPLOY_USER"
	ok "created, with no password"
fi

install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
ok "the .ssh directory is present and private"

# ---------------------------------------------------------------------------- docker
step "Docker Engine and Compose"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
	already "already installed ($(docker --version | cut -d' ' -f3 | tr -d ,))"
else
	export DEBIAN_FRONTEND=noninteractive
	apt-get update -qq
	apt-get install -y -qq ca-certificates curl >/dev/null

	install -m 0755 -d /etc/apt/keyrings
	if [ ! -s /etc/apt/keyrings/docker.asc ]; then
		curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
		chmod a+r /etc/apt/keyrings/docker.asc
		ok "added Docker's signing key"
	fi

	# shellcheck source=/dev/null
	codename="$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
	cat > /etc/apt/sources.list.d/docker.list <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $codename stable
EOF

	apt-get update -qq
	apt-get install -y -qq \
		docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
	ok "installed $(docker --version | cut -d' ' -f3 | tr -d ,)"
fi

if systemctl enable --now docker >/dev/null 2>&1; then
	ok "docker service starts at boot"
elif [ -d /run/systemd/system ]; then
	fail "could not enable the docker service; check 'systemctl status docker'."
else
	# A container or WSL, where this script is only ever being tried out.
	already "no systemd here, so nothing to enable"
fi

# Membership is what lets the deploy user run docker without sudo; `usermod -aG` is a no-op when
# the user is already in the group.
usermod -aG docker "$DEPLOY_USER"
ok "$DEPLOY_USER is in the docker group"

# ---------------------------------------------------------------------------- swap
step "Swap (${SWAP_SIZE_MB} MB)"

if swapon --show=NAME --noheadings 2>/dev/null | grep -qx "$SWAP_FILE"; then
	already "$SWAP_FILE is already in use"
else
	if [ ! -f "$SWAP_FILE" ]; then
		# dd rather than fallocate: a sparse file is instant to create and swapon refuses it.
		dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$SWAP_SIZE_MB" status=none
		ok "created $SWAP_FILE"
	fi
	chmod 600 "$SWAP_FILE"

	# Asked rather than assumed, so a re-run is quiet — and so a file left unformatted by an
	# interrupted run is still put right rather than failing swapon for ever.
	if ! swaplabel "$SWAP_FILE" >/dev/null 2>&1; then
		mkswap "$SWAP_FILE" >/dev/null
		ok "formatted as swap"
	fi

	if swapon "$SWAP_FILE" 2>/dev/null; then
		ok "swap is on"
	elif [ -d /run/systemd/system ]; then
		fail "could not enable swap on $SWAP_FILE."
	else
		already "swapon is not permitted here (a container); the file is ready for a real host"
	fi
fi

if grep -qs "^$SWAP_FILE " /etc/fstab; then
	already "listed in /etc/fstab"
else
	printf '%s none swap sw 0 0\n' "$SWAP_FILE" >> /etc/fstab
	ok "added to /etc/fstab so it survives a reboot"
fi

# ---------------------------------------------------------------------------- app directory
step "Application directory ($APP_DIR)"

install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR/backups"
ok "owned by $DEPLOY_USER"

# ---------------------------------------------------------------------------- report
step "Ready"

printf '    docker:  %s\n' "$(docker --version)"
printf '    compose: %s\n' "$(docker compose version --short)"
printf '    swap:    %s\n' "$(free -h | awk '/Swap:/ {print $2 " total, " $3 " used"}')"
printf '    user:    %s\n' "$(id "$DEPLOY_USER")"

cat <<EOF

Next, as described in docs/RUNNING.md:

  1. Allow only 22, 80 and 443 in the DigitalOcean cloud firewall.
  2. Point your DNS A record at this droplet.
  3. Put docker-compose.yml, Caddyfile and .env in $APP_DIR.
  4. sudo -u $DEPLOY_USER -H sh -c 'cd $APP_DIR && docker compose up -d'

This script did not touch SSH, the firewall or authorized_keys — those are decisions rather than
mechanics, and the deploy key belongs to the release workflow.

On the firewall: use your provider's cloud firewall, not just ufw. Docker puts its own iptables
rules ahead of ufw's, so any port it publishes is reachable from the internet no matter what ufw
says. docker-compose.yml publishes nothing for Postgres, which is what keeps 5432 shut.
EOF
