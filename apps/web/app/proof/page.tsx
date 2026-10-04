import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Proof lookup, so a bare job id can be pasted anywhere.
 *
 * The network is carried through the redirect. Dropping it meant the lookup
 * landed on whatever the browser remembered rather than the chain the job
 * actually settled on — and since job ids are per-network, a testnet job
 * looked up from a mainnet view resolved to "no such proof".
 */
export default async function ProofSearch({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; net?: string }>;
}) {
  const { id, net } = await searchParams;

  // Only the two real networks are forwarded. Anything else is dropped rather
  // than reflected into the URL, so this cannot become an open redirect.
  const network = net === "mainnet" || net === "testnet" ? net : null;
  const suffix = network ? `?net=${network}` : "";

  if (id) redirect(`/proof/${id.trim()}${suffix}`);
  redirect("/");
}