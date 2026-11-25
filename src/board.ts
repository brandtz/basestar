// Team board data, shared by the Now tab and the Requests badge.
import { reactive } from 'vue';
import type { Board } from '../shared/types';
import { get } from './api';
import { state } from './state';

export const boardState = reactive({ board: null as Board | null, loading: false, error: '', fetchedAt: 0 });

export async function refreshBoard() {
  if (boardState.loading) return;
  boardState.loading = true;
  try {
    const b = await get<Board>('/board');
    boardState.board = b;
    boardState.error = '';
    boardState.fetchedAt = Date.now();
    state.pending = b.pendingForMe;
    state.today = b.today;
  } catch (e) {
    boardState.error = (e as Error).message;
  } finally {
    boardState.loading = false;
  }
}
