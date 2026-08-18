import GrillView from "@/components/GrillView";

export default async function GrillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <GrillView sessionId={id} />;
}
