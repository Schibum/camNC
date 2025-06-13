import { FluidncServer } from '@wbcnc/fluidnc-api/fluidnc-server';
import { Card, CardContent, CardHeader, CardTitle } from '@wbcnc/ui/components/card';

export function ServerCard({ server }: { server: FluidncServer }) {
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
              server.numConnected.value === 0 ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
            }`}>
            {server.numConnected.value} connected
          </span>
        </div>
        <div>
          <p className="text-sm text-gray-500">Access token</p>
          <span className="inline-block mt-1 px-3 py-1 text-xs font-semibold bg-blue-100 text-blue-800 rounded-lg">
            {server.accessToken}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
