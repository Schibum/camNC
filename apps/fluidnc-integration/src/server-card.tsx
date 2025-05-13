import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@wbcnc/ui/components/card";

export function ServerCard({
  status,
  roomId,
}: {
  status: string;
  roomId: string;
}) {
  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>CNC Cam</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <p className="text-sm text-gray-500">Connection Status</p>
          <span
            className={`inline-block mt-1 px-3 py-1 text-xs font-semibold rounded-full ${
              status.toLowerCase() === "connected"
                ? "bg-green-100 text-green-800"
                : status.toLowerCase() === "disconnected"
                  ? "bg-red-100 text-red-800"
                  : "bg-gray-100 text-gray-800"
            }`}
          >
            {status}
          </span>
        </div>
        <div>
          <p className="text-sm text-gray-500">Access token</p>
          <span className="inline-block mt-1 px-3 py-1 text-xs font-semibold bg-blue-100 text-blue-800 rounded-lg">
            {roomId}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
