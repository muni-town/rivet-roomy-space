FROM oven/bun:1

# Uncomment if building on network with a custom certificate
#COPY ./gitignore/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
#ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

COPY . /project
WORKDIR /project

RUN bun install
WORKDIR /project/actors
CMD ["bun", "start"]