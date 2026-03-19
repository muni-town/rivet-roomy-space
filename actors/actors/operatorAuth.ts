import { actor } from "rivetkit";
import { EdDSASigner } from "iso-signatures/signers/eddsa.js";
import { type } from "arktype";

const CreateInput = type({
  adminDids: type("string[]"),
});
type CreateInput = typeof CreateInput.infer;

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
    const input = CreateInput(rawInput);
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
  vars: undefined as unknown as {
    signer: EdDSASigner;
  },
  createVars: async (c) => {
    // This can happen if creation fails, but this lifecycle hook will still run
    if (c.aborted) return undefined as any;

    return {
      signer: await EdDSASigner.import(c.state.privateKey),
    };
  },
  actions: {
    /** Get the signing key for the operator actor. */
    signingKey(c) {
      return c.vars.signer.toString();
    },
  },
});
