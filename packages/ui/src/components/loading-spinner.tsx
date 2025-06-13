import { LoaderCircle, LucideProps } from "lucide-react";

import { cn } from "@wbcnc/ui/lib/utils";

export interface IProps extends LucideProps {
  className?: string;
}

export const LoadingSpinner = ({ className, ...props }: IProps) => {
  return <LoaderCircle className={cn("animate-spin", className)} {...props} />;
};
