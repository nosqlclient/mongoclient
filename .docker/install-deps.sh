#!/bin/bash

set -e

printf "\n[-] Installing base OS dependencies...\n\n"

apt-get update -y

apt-get install -y --no-install-recommends curl ca-certificates bzip2 build-essential numactl python git wget bsdtar

curl -O -L http://security.debian.org/debian-security/pool/updates/main/o/openssl/libssl1.1_1.1.0l-1~deb9u3_amd64.deb
dpkg -i libssl1.1_1.1.0l-1~deb9u3_amd64.deb
rm libssl1.1_1.1.0l-1~deb9u3_amd64.deb

dpkgArch="$(dpkg --print-architecture | awk -F- '{ print $NF }')"

wget -O /usr/local/bin/gosu "https://github.com/tianon/gosu/releases/download/$GOSU_VERSION/gosu-$dpkgArch"
wget -O /usr/local/bin/gosu.asc "https://github.com/tianon/gosu/releases/download/$GOSU_VERSION/gosu-$dpkgArch.asc"

export GNUPGHOME="$(mktemp -d)"

gpg --keyserver hkp://p80.pool.sks-keyservers.net:80 --recv-keys B42F6819007F00F88E364FD4036A9C25BF357DD4
gpg --batch --verify /usr/local/bin/gosu.asc /usr/local/bin/gosu

rm -r "$GNUPGHOME" /usr/local/bin/gosu.asc

chmod +x /usr/local/bin/gosu

gosu nobody true

apt-get purge -y --auto-remove wget
