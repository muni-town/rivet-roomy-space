import { actor, ActorDefinition, UserError } from "rivetkit";
import { EdDSASigner } from "iso-signatures/signers/eddsa.js";
import { Store } from "iso-ucan/store";
import { type } from "arktype";
import { capabilities, kvDriver, verifierResolver } from "../ucan";
import { Capability } from "iso-ucan/capability";
import { IdResolver, MemoryCache } from "@atproto/identity";
import { verifyJwt } from "@atproto/xrpc-server";
import { DID } from "iso-ucan/types";
import { Invocation } from "iso-ucan/invocation";

const ActorCreateInput = type({
  adminDids: "string[]",
});

const ConnParams = type({
  clientDid: "string",
  serviceAuthToken: "string",
}).or(type.undefined);

type State = { privateKey: string; adminDids: string[] };
type ConnState = { did: string; clientDid: string } | undefined;
type Vars = {
  signer: EdDSASigner;
  store: Store;
  idResolver: IdResolver;
};

export const operatorAuth = actor({
  state: {
    privateKey: "",
    adminDids: [] as string[],
  },
  onCreate: async (c, rawInput) => {
    // This is a singleton actor that can only be created as "main"
    if (c.key.length != 1 || c.key[0] != "main") {
      console.error(
        'Cannot create operatorAuth actor with key other than ["main"]:',
        c.key,
      );
      // If this actor is not "main" immediately destroy it
      c.destroy();
      return;
    }

    // Error if no admin DIDs were specified
    const input = ActorCreateInput(rawInput);
    if (input instanceof type.errors) {
      console.error("Invalid creation input to operatorAuth:", input.summary);
      c.destroy();
      return;
    }

    // Set the admin IDS
    c.state.adminDids = input.adminDids;

    // Generate a new signing key
    c.state.privateKey = (await EdDSASigner.generate()).export();
  },
  createVars: async (c) => {
    // This can happen if creation fails, but this lifecycle hook will still run
    if (c.aborted) return undefined as any;

    return {
      signer: await EdDSASigner.import(c.state.privateKey),
      store: new Store(kvDriver(c.kv)),
      idResolver: new IdResolver({
        didCache: new MemoryCache(),
      }),
    };
  },

  createConnState: async (c, rawParams?): Promise<ConnState> => {
    const { idResolver } = c.vars as Vars;

    const params = ConnParams(rawParams);
    if (!params) return;

    try {
      // Parse parameters
      if (params instanceof type.errors) {
        throw new UserError(
          `Failed to parse connection parameters: ${params.summary}`,
        );
      }

      const jwt = params.serviceAuthToken;

      const payload = await verifyJwt(
        jwt,
        null,
        null,
        async (did, forceRefresh) => {
          const atprotoData = await idResolver.did.resolveAtprotoData(
            did,
            forceRefresh,
          );
          return atprotoData.signingKey;
        },
      );
      const did = payload.iss;

      if (!c.state.adminDids.includes(did)) {
        throw new UserError("User is not an admin.");
      }

      return { did, clientDid: params.clientDid };
    } catch (e) {
      console.warn("Auth error", e);
      return undefined;
    }
  },

  actions: {
    /** Get the signing key for the operator actor. */
    signingKey(c) {
      return c.vars.signer.toString();
    },
    requestEchoDelegation: async (c) => {
      if (!c.conn.state?.did) throw new UserError("Not authenticated");

      const delegation = await capabilities.Echo.delegate({
        iss: c.vars.signer,
        aud: c.conn.state.clientDid as DID,
        store: c.vars.store,
        sub: c.vars.signer.did,
        pol: [],
        exp: Math.round(Date.now() / 1000) + 3600,
      });
      await c.vars.store.add([delegation]);

      return { delegation: delegation.toString() };
    },
    echo: async ({ vars: { signer, store } }, rawInvocation: Uint8Array) => {
      const invocation = await Invocation.from({
        bytes: rawInvocation,
        audience: signer.verifiableDid,
        resolveProof: store.resolveProof.bind(store),
        verifierResolver,
      });

      const args = capabilities.Echo.schema(invocation.payload.args as any);
      if (args instanceof type.errors) {
        throw new UserError(`Could not parse arguments: ${args.summary}`);
      }

      return { content: args.content };
    },
  },
}) satisfies ActorDefinition<
  State,
  typeof ConnParams.infer,
  ConnState,
  Vars,
  typeof ActorCreateInput.infer,
  any
>;
