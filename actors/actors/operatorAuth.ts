import { actor, ActorDefinition, UserError } from "rivetkit";
import { EdDSASigner } from "iso-signatures/signers/eddsa.js";
import { Store } from "iso-ucan/store";
import { type } from "arktype";
import { capabilities, kvDriver, verifierResolver } from "../ucan";
import { IdResolver, MemoryCache } from "@atproto/identity";
import { verifyJwt } from "@atproto/xrpc-server";
import { Invocation } from "iso-ucan/invocation";
import { Delegation } from "iso-ucan/delegation";

const ActorCreateInput = type({
  adminDids: "string[]",
});
const ConnParams = type({
  clientDid: "string",
  serviceAuthToken: "string",
})
  .or(type.undefined)
  .or(type.null);
type State = {
  privateKey: string;
  adminDids: string[];
};
type ConnState = { did: string; clientDid: string } | undefined;
type Vars = {
  signer: EdDSASigner;
  store: Store;
  idResolver: IdResolver;
};

export const operatorAuth = actor({
  options: {
    sleepTimeout: 2000,
  },

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

    // Parse creation args
    const input = ActorCreateInput(rawInput);
    if (input instanceof type.errors) {
      console.error("Invalid creation input to operatorAuth:", input.summary);
      c.destroy();
      return;
    }

    // Initialize state
    c.state.adminDids = input.adminDids;
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

    // Parse the connection params or return an unauthenticated connection.
    const params = ConnParams(rawParams);
    if (!params) return;

    try {
      if (params instanceof type.errors) {
        throw new UserError(
          `Failed to parse connection parameters: ${params.summary}`,
        );
      }

      // Get the ATProto service auth JWT
      const jwt = params.serviceAuthToken;

      // Verify the service auth JWT
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

      // Get the authenticated DID
      const did = payload.iss;

      // Make sure the user is an admin
      if (!c.state.adminDids.includes(did)) {
        throw new UserError("User is not an admin.");
      }

      // Return authenticated connection
      return { did, clientDid: params.clientDid };
    } catch (e) {
      throw new UserError(`Authentication error: ${e}`);
    }
  },

  actions: {
    /** Get the signing key for the operator actor. */
    signingKey(c) {
      return c.vars.signer.toString();
    },

    /** Get the admin  */
    requestAdminDelegations: async (c) => {
      if (!c.conn.state?.did) throw new UserError("Not authenticated");

      const delegations = [
        // Create a delegation that allows all access to the operatorAuth actor
        await Delegation.create({
          iss: c.vars.signer,
          aud: c.conn.state.clientDid,
          sub: c.vars.signer.did,
          pol: [],
          exp: Math.round(Date.now() / 1000) + 3600, // Last one hour
          cmd: "/",
        }),
      ];

      await c.vars.store.add(delegations);

      return { delegations: delegations.map((x) => x.toString()) };
    },

    /** Simple test endpoint that demonstrates UCAN auth. */
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
