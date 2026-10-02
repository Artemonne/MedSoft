import { Alert, CircularProgress, Snackbar, Stack, Typography } from '@mui/material';

export function LoadingState() {
  return <Stack direction="row" gap={2} alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} /><Typography>Загрузка…</Typography></Stack>;
}

export function ErrorState({ message = 'Не удалось загрузить данные.' }: { message?: string }) {
  return <Alert severity="error">{message}</Alert>;
}

export function FeedbackSnackbar({ message, onClose }: { message: string | null; onClose: () => void }) {
  return (
    <Snackbar open={Boolean(message)} autoHideDuration={5000} onClose={onClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
      <Alert severity="error" variant="filled" onClose={onClose}>{message}</Alert>
    </Snackbar>
  );
}
