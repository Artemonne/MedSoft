import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Удалить', pending, onCancel, onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={pending ? undefined : onCancel}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent><DialogContentText>{message}</DialogContentText></DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={pending}>Отмена</Button>
        <Button onClick={onConfirm} color="error" variant="contained" disabled={pending}>{confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}
