import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Proof lookup, so a bare job id can be pasted anywhere. */
export default async function ProofSearch({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  if (id) redirect(`/proof/${id.trim()}`);
  redirect("/");
}
