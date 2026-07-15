# syntax=docker/dockerfile:1

# Reuse the battle-tested official initialization script without inheriting
# its single 100+ MB PostgreSQL layer, which the private registry proxy cannot
# accept. The runtime below uses Alpine's matching PostgreSQL 16.14 packages.
FROM postgres:16.14-alpine@sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb AS official

FROM alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc

ARG PGVECTOR_VERSION=0.8.1
ARG PGVECTOR_SHA256=a9094dfb85ccdde3cbb295f1086d4c71a20db1d26bf1d6c39f07a7d164033eb4

RUN apk add --no-cache \
      bash \
      postgresql16=16.14-r0 \
      postgresql16-client=16.14-r0 \
      tzdata \
      zstd \
    && apk add --no-cache --virtual .pgvector-build-deps \
      build-base \
      ca-certificates \
      curl \
      postgresql16-dev=16.14-r0 \
    && curl -fsSL \
      "https://github.com/pgvector/pgvector/archive/refs/tags/v${PGVECTOR_VERSION}.tar.gz" \
      -o /tmp/pgvector.tar.gz \
    && echo "${PGVECTOR_SHA256}  /tmp/pgvector.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/pgvector.tar.gz -C /tmp \
    && make -C "/tmp/pgvector-${PGVECTOR_VERSION}" OPTFLAGS="" with_llvm=no \
    && make -C "/tmp/pgvector-${PGVECTOR_VERSION}" install with_llvm=no \
    && rm -rf /tmp/pgvector.tar.gz "/tmp/pgvector-${PGVECTOR_VERSION}" \
    && apk del .pgvector-build-deps

COPY --from=official /usr/local/bin/docker-entrypoint.sh /usr/local/bin/
COPY --from=official /usr/local/bin/gosu /usr/local/bin/

ENV PGDATA=/var/lib/postgresql/data

RUN mkdir -p "$PGDATA" /var/run/postgresql /docker-entrypoint-initdb.d \
    && chown -R postgres:postgres "$PGDATA" /var/run/postgresql \
    && chmod 3777 /var/run/postgresql

VOLUME /var/lib/postgresql/data
EXPOSE 5432

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["postgres"]
