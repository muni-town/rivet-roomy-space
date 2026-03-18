FROM node:25

# Uncomment if building on network with a custom certificate
#COPY ./gitignore/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
#ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

RUN npm i -g pnpm

COPY . /project
WORKDIR /project

RUN pnpm i
WORKDIR /project/actors
CMD ["pnpm", "start"]