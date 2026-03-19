import { type ActorKv, UserError } from "rivetkit";
import type { Driver } from "iso-kv";

import * as EdDSA from "iso-signatures/verifiers/eddsa.js";
import { Resolver } from "iso-signatures/verifiers/resolver.js";
import { Capability } from "iso-ucan/capability";
import { type } from "arktype";
import { DID } from "iso-did";
import { Invocation } from "iso-ucan/invocation";
import type { Store } from "iso-ucan/store";

export const verifierResolver = new Resolver({
  ...EdDSA.verifier,
});

export async function validateAdminInvocation(opts: {
  operatorAuthDid: string | DID;
  expectedCmd: string;
  store: Store;
  invocation: Uint8Array;
}) {
  const did =
    typeof opts.operatorAuthDid === "string"
      ? await DID.fromString(opts.operatorAuthDid)
      : opts.operatorAuthDid;

  const inv = await Invocation.from({
    bytes: opts.invocation,
    audience: did.verifiableDid,
    verifierResolver,
    resolveProof: (x) => opts.store.resolveProof(x),
  });
  if (inv.payload.cmd !== "/actor/create") {
    throw new UserError(
      `Invalid invocation command ( ${inv.payload.cmd} ) expected /actor/create`,
    );
  }
}

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
      // biome-ignore lint/suspicious/noExplicitAny: Hack 'cause the DriverAsync type we need isn't public in iso-kv
      return driver as any;
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
  CreateActor: Capability.from({
    cmd: "/actor/create",
    schema: type({}),
    verifierResolver,
  }),
};
