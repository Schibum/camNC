import { PageHeader } from '@/components/page-header';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { zodValidator } from '@tanstack/zod-adapter';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@wbcnc/ui/components/alert-dialog';
import { Button } from '@wbcnc/ui/components/button';
import { Trash2 } from 'lucide-react';
import { z } from 'zod';
import { IOnChangeArgs, VideoSourceSelection } from '../../setup/video-source-selection/VideoSourceSelection';
import { useCamSource, useStore } from '../../store/store';

export const Route = createFileRoute('/setup/url-entry')({
  component: UrlEntryComponent,
  validateSearch: zodValidator(
    z.object({
      new: z.boolean().optional(),
    })
  ),
});

function DeleteCameraButton() {
  const currentCamSource = useCamSource();
  const deleteCamSource = useStore(state => state.deleteCamSource);
  const activeCamId = useStore(state => state.activeCamId);
  const navigate = useNavigate();
  const handleDelete = () => {
    if (activeCamId) {
      deleteCamSource(activeCamId);
      navigate({ to: '/' });
    }
  };
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="secondary" size="sm" className="gap-2">
          <Trash2 className="h-4 w-4" />
          Delete Camera Source
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Camera Source</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete &quot;{currentCamSource?.name}&quot;? This action cannot be undone and will remove all
            calibration data and settings for this camera source.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function UrlEntryComponent() {
  const navigate = useNavigate();
  const { new: isNew } = Route.useSearch();
  const camSources = useStore(state => state.camSources);
  const camNames = Object.values(camSources).map(source => source.name);
  const currentCamSource = useCamSource();
  const activeCamId = useStore(state => state.activeCamId);
  const url = isNew ? '' : currentCamSource?.url;
  const defaultName = isNew ? `New Camera Source ${camNames.length + 1}` : (currentCamSource?.name ?? 'default');

  const updateCamSource = useStore(state => state.updateCamSource);
  const addCamSource = useStore(state => state.addCamSource);

  const handleUrlConfirm = ({ url: newUrl, maxResolution, name: newName }: IOnChangeArgs) => {
    if (isNew) {
      addCamSource(newName, { name: newName, url: newUrl, maxResolution: [maxResolution.width, maxResolution.height] });
    } else {
      if (activeCamId) {
        updateCamSource(activeCamId, {
          name: newName,
          url: newUrl,
          maxResolution: [maxResolution.width, maxResolution.height],
        });
      }
    }
    navigate({ to: '/setup/camera-calibration' });
  };

  return (
    <div className="w-full h-full">
      <PageHeader title="Camera Source" />
      <div className="flex justify-center p-1 flex-row">
        <div className="max-w-xl gap-4 flex flex-1 flex-col">
          <VideoSourceSelection value={url} onChange={handleUrlConfirm} defaultName={defaultName} key={url} />
          {!isNew && activeCamId && (
            <div className="flex justify-start">
              <DeleteCameraButton />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
