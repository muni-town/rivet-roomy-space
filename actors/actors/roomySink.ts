import { actor, type ActorDefinition, UserError } from "rivetkit";
import { EdDSASigner } from "iso-signatures/signers/eddsa.js";
import { Store } from "iso-ucan/store";
import { type } from "arktype";
import { kvDriver, verifierResolver } from "../ucan";
import { Invocation } from "iso-ucan/invocation";
import { Delegation } from "iso-ucan/delegation";
import type { registry } from "../actors";
import { MemoryDriver } from "iso-kv/drivers/memory.js";
import { DID } from "iso-did";

const ActorCreateInput = type({
  /** The handle / DID of the ATProto account to use to connect to Roomy. */
  atprotoUsername: "string",
  /** The App Password of the ATProto account to use to connect to Roomy. */
  atprotoAppPassword: "string",
  /** The ID of the roomy space that we are syncing to. */
  roomySpaceDid: "string",
  /** Create actor invocation signed by the operatorAuth actor. */
  invocation: type.instanceOf(Uint8Array),
  /** Delegations neede */
  delegations: "string[]",
});
const ConnParams = type({}).or(type.undefined);
type State = {
  privateKey: string;
  atprotoUsername: string;
  atprotoAppPassword: string;
  roomySpaceDid: string;
  operatorAuthDid: string;
};
type ConnState = undefined;
type Vars = {
  signer: EdDSASigner;
  store: Store;
  operatorAuthDid: DID;
};

export const roomySink = actor({
  state: {
    atprotoUsername: "",
    atprotoAppPassword: "",
    roomySpaceDid: "",
    privateKey: "",
    operatorAuthDid: "",
  },

  onCreate: async (c, rawInput) => {
    try {
      // Parse creation args
      const input = ActorCreateInput(rawInput);
      if (input instanceof type.errors) {
        console.error("Invalid creation input to operatorAuth:", input.summary);
        c.destroy();
        return;
      }

      // Get the operator auth key
      const operatorAuth = c.client<typeof registry>().operatorAuth.get("main");
      const operatorAuthDidStr = await operatorAuth.signingKey();
      const operatorAuthDid = await DID.fromString(operatorAuthDidStr);

      const store = new Store(new MemoryDriver());
      await store.add(
        await Promise.all(
          input.delegations.map((x) => Delegation.fromString(x)),
        ),
      );

      // Validate the invocation to create the
      const invocation = await Invocation.from({
        bytes: input.invocation,
        audience: operatorAuthDid.verifiableDid,
        verifierResolver,
        resolveProof: (x) => store.resolveProof(x),
      });
      if (invocation.payload.cmd !== "/actor/create") {
        throw new UserError(
          `Invalid invocation command ( ${invocation.payload.cmd} ) expected /actor/create`,
        );
      }

      // Generate a private key
      const key = await EdDSASigner.generate();

      // Initialize state
      c.state.atprotoUsername = input.atprotoUsername;
      c.state.atprotoAppPassword = input.atprotoAppPassword;
      c.state.roomySpaceDid = input.roomySpaceDid;
      c.state.privateKey = key.export();
      c.state.operatorAuthDid = operatorAuthDidStr;
    } catch (e) {
      console.error(e);
      c.destroy();
    }
  },

  createVars: async (c): Promise<Vars> => {
    // This can happen if creation fails, but this lifecycle hook will still run
    // biome-ignore lint/suspicious/noExplicitAny: we don't use the resulting value.
    if (c.aborted) return undefined as any;

    return {
      signer: await EdDSASigner.import(c.state.privateKey),
      store: new Store(kvDriver(c.kv)),
      operatorAuthDid: await DID.fromString(c.state.operatorAuthDid),
    };
  },

  createConnState: async (): Promise<ConnState> => {
    return;
  },

  actions: {
    /** Get the signing key for the operator actor. */
    signingKey(c) {
      return c.vars.signer.toString();
    },
  },
}) satisfies ActorDefinition<
  State,
  typeof ConnParams.infer,
  ConnState,
  Vars,
  typeof ActorCreateInput.infer,
  // biome-ignore lint/suspicious/noExplicitAny: we don't use the DB so we just need any here.
  any
>;
