FROM oven/bun:1.3.11-alpine AS builder

# Uncomment if building on network with a custom certificate
#COPY ./gitignore/ca-certificates.crt /etc/ssl/cert.pem
#ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

COPY . /project
WORKDIR /project/actors

RUN bun install
RUN bun build --compile --minify --sourcemap --bytecode serve.ts --outfile /actors

FROM oven/bun:1.3.11-alpine
COPY --from=builder /actors /
ENTRYPOINT ["/actors"]