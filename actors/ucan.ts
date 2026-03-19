import { ActorKv } from "rivetkit";
import { Driver } from "iso-kv";

import * as EdDSA from "iso-signatures/verifiers/eddsa.js";
import { Resolver } from "iso-signatures/verifiers/resolver.js";
import { Capability } from "iso-ucan/capability";
import { type } from "arktype";

export const verifierResolver = new Resolver({
  ...EdDSA.verifier,
});

/** Key-value key segment separator */

const UCAN_KEY_PREFIX = "ucan:";
export function kvDriver(kv: ActorKv): Driver {
  const k = (subkey: string) => `${UCAN_KEY_PREFIX}${subkey}`;
  const driver: Driver = {
    async clear() {
      const records = await kv.list(UCAN_KEY_PREFIX);
      await kv.deleteBatch(records.map(([subkey, _value]) => k(subkey)));
    },
    async delete(key) {
      await kv.delete(k(key));
    },
    async get(key) {
      const v = await kv.get(k(key));
      return v ? JSON.parse(v) : null;
    },
    async has(key) {
      return (await kv.get(k(key))) != null;
    },
    async set(key, value) {
      await kv.put(k(key), JSON.stringify(value));
      return driver as any; // Hack 'cause the DriverAsync type we need isn't public in iso-kv
    },
    async *[Symbol.asyncIterator]() {
      const list = await kv.list(UCAN_KEY_PREFIX);
      for (const [key, value] of list) {
        yield [key, value];
      }
    },
  };

  return driver;
}

export const capabilities = {
  Echo: Capability.from({
    cmd: "/echo",
    schema: type({
      content: "string",
    }),
    verifierResolver,
  }),
};
