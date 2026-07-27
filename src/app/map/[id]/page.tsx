import MapView from "@/components/MapView";

export default async function MapPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MapView jobId={id} />;
}
