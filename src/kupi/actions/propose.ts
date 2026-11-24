import type {
  KupiAction,
  KupiActionProposal,
} from "../contracts";
import type { Transaction } from "@/domain/types";

function cloneTransaction(transaction: Transaction): Transaction {
  return {
    ...transaction,
    tags: transaction.tags ? [...transaction.tags] : transaction.tags,
    attachmentIds: transaction.attachmentIds ? [...transaction.attachmentIds] : transaction.attachmentIds,
  };
}

export function proposeAction(
  proposals: readonly KupiActionProposal[],
  idFactory: () => string = () => crypto.randomUUID()
): KupiAction[] {
  return proposals.map((proposal) => {
    const id = idFactory();
    if (!id.trim()) throw new Error("Kupi action id must not be empty.");

    switch (proposal.kind) {
      case "create":
        return {
          id,
          profileId: proposal.profileId,
          kind: "create",
          before: null,
          after: {
            ...proposal.after,
            tags: proposal.after.tags ? [...proposal.after.tags] : proposal.after.tags,
            attachmentIds: proposal.after.attachmentIds ? [...proposal.after.attachmentIds] : proposal.after.attachmentIds,
          },
          warnings: [],
        };
      case "transfer":
        return {
          id,
          profileId: proposal.profileId,
          kind: "transfer",
          before: null,
          after: { ...proposal.after },
          warnings: [],
        };
      case "update": {
        const before = cloneTransaction(proposal.before);
        const after: Transaction = {
          ...before,
          ...proposal.changes,
          profileId: proposal.profileId,
        };
        return { id, profileId: proposal.profileId, kind: "update", before, after, warnings: [] };
      }
      case "delete":
        return {
          id,
          profileId: proposal.profileId,
          kind: "delete",
          before: cloneTransaction(proposal.before),
          after: null,
          warnings: [],
        };
    }
  });
}
