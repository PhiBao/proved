import ProofView from "./ProofView";

/**
 * The route is a thin shell so the actual proof renders on the client, where the
 * chosen network is known. See ProofView for why.
 */
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ProofView params={params} />;
}
