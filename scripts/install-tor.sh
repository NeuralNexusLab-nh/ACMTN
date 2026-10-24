#!/usr/bin/env bash
set -euo pipefail

# Download authenticated distribution packages and unpack them into this build.
# No sudo, system installation, persistent disk, or second service is needed.
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime="$project_root/.runtime/tor"
build_tmp="$(mktemp -d /tmp/neutron-tor-build.XXXXXXXX)"
cleanup() {
  case "$build_tmp" in /tmp/neutron-tor-build.*) rm -rf -- "$build_tmp" ;; esac
}
trap cleanup EXIT
mkdir -p "$build_tmp/lists/partial" "$build_tmp/cache/archives/partial" "$build_tmp/packages" "$build_tmp/root"
apt_options=(
  -o "Dir::State::lists=$build_tmp/lists"
  -o "Dir::State::status=/dev/null"
  -o "Dir::Cache=$build_tmp/cache"
  -o "Debug::NoLocking=1"
  -o "APT::Sandbox::User=$(id -un)"
)
apt-get "${apt_options[@]}" -o APT::Update::Error-Mode=any update
plan="$(apt-get "${apt_options[@]}" --simulate --no-install-recommends install tor)"
mapfile -t packages < <(printf '%s\n' "$plan" | awk '/^Inst / { print $2 }')
if (( ${#packages[@]} == 0 )); then
  printf '%s\n' 'Tor dependency resolution produced no packages.' >&2
  exit 1
fi
(
  cd "$build_tmp/packages"
  apt-get "${apt_options[@]}" download "${packages[@]}"
)
for archive in "$build_tmp/packages/"*.deb; do
  package="$(dpkg-deb --field "$archive" Package)"
  # Use the host C runtime and loader together to avoid GLIBC_PRIVATE conflicts.
  case "$package" in libc6|libc-bin) continue ;; esac
  dpkg-deb --extract "$archive" "$build_tmp/root"
done
test -x "$build_tmp/root/usr/bin/tor"
mkdir -p "$project_root/.runtime"
if [[ -L "$runtime" ]]; then
  printf '%s\n' 'Refusing to install over a runtime symlink.' >&2
  exit 1
fi
if [[ -d "$runtime" && "$runtime" == "$project_root/.runtime/tor" ]]; then
  rm -rf -- "$runtime"
fi
mv -- "$build_tmp/root" "$runtime"
case "$(dpkg --print-architecture)" in
  amd64) triplet=x86_64-linux-gnu ;;
  arm64) triplet=aarch64-linux-gnu ;;
  *) printf '%s\n' 'Unsupported Tor runtime architecture.' >&2; exit 1 ;;
esac
LD_LIBRARY_PATH="$runtime/usr/lib/$triplet:$runtime/lib/$triplet:$runtime/usr/lib:$runtime/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" "$runtime/usr/bin/tor" --version
printf '%s\n' 'Tor is installed in the application build; no system packages were installed.'
