FROM alpine/git:latest as repo

ARG GITHUB_TOKEN
ENV GITHUB_TOKEN=${GITHUB_TOKEN}

ARG RAILWAY_GIT_COMMIT_SHA
ENV RAILWAY_GIT_COMMIT_SHA=${RAILWAY_GIT_COMMIT_SHA}

RUN echo "Cache bust: ${RAILWAY_GIT_COMMIT_SHA}"

RUN mkdir /repo
WORKDIR /repo

RUN git config --global url."https://${GITHUB_USERNAME}:${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
RUN git clone --depth=1 --single-branch --branch main ${GIT_REPO_URL} .
RUN git submodule init && git submodule update --depth=1

FROM oven/bun:1.3.11-alpine AS builder

COPY --from=repo /repo /project

# Uncomment if building on network with a custom certificate
#COPY ./gitignore/ca-certificates.crt /etc/ssl/cert.pem
#ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

WORKDIR /project
RUN bun install
WORKDIR /project/actors

RUN bun install
RUN bun build --compile --minify --sourcemap --bytecode serve.ts --outfile /actors

FROM oven/bun:1.3.11-alpine
COPY --from=builder /actors /
ENTRYPOINT ["/actors"]