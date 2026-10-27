import { useActiveCamId, useAllCamSources, useSetActiveCam } from '@/store/store';
import { Link } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@wbcnc/ui/components/tooltip';
import { Pencil, Plus } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';

export function CamSourceSelector() {
  const camSources = useAllCamSources();
  const activeCamId = useActiveCamId();
  const setActiveCam = useSetActiveCam();

  // Create array of [id, name] pairs for the select options
  const camOptions = Object.entries(camSources).map(([id, source]) => ({
    id,
    name: source.name,
  }));

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex flex-row gap-1">
        <Select value={activeCamId ?? ''} onValueChange={setActiveCam} disabled={camOptions.length === 0}>
          <SelectTrigger className="w-full min-w-0">
            <SelectValue placeholder="Select camera" />
          </SelectTrigger>
          <SelectContent>
            {camOptions.map(({ id, name }) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {activeCamId && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" asChild>
                {/* Editing the source keeps the camera's calibration and markers. */}
                <Link to="/setup/url-entry" aria-label="Change camera source">
                  <Pencil />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Change source, keep calibration</TooltipContent>
          </Tooltip>
        )}
      </div>
      <Button size="sm" variant="outline" asChild>
        <Link to="/setup/url-entry" search={{ new: true }}>
          <Plus /> Add Camera
        </Link>
      </Button>
    </div>
  );
}
