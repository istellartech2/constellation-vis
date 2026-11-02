import { useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm?: () => void;
  destructive?: boolean;
  initialFocus?: "confirm" | "cancel";
}

export default function NoticeDialog({ open, onClose, title, description, confirmLabel, onConfirm, destructive, initialFocus = "confirm" }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        // Replacement/deletion flows can keep accidental Enter on the safe action.
        onOpenAutoFocus={(e) => { const target = initialFocus === "cancel" ? cancelRef.current : confirmRef.current; if (target) { e.preventDefault(); target.focus(); } }}
      >
        <DialogHeader className="text-left">
          <div className={`mb-1 flex size-10 items-center justify-center rounded-xl ${destructive ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"}`}>
            <AlertTriangle className="size-5" aria-hidden="true" />
          </div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="whitespace-pre-line leading-relaxed text-fg-muted">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button ref={cancelRef} variant="outline" onClick={onClose}>{onConfirm ? "キャンセル" : "閉じる"}</Button>
          {onConfirm && <Button ref={confirmRef} variant={destructive ? "destructive" : "default"} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel ?? "続ける"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
