import { useEffect, useRef } from 'react';
import { BackendUrl } from '@/config';

const HEARTBEAT_INTERVAL = 60000;

export function useSandboxHeartbeat(sandboxId: string | null) {
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (!sandboxId) {
            return;
        }

        const sendHeartbeat = async () => {
            try {
                const token = localStorage.getItem('auth_token');
                await fetch(`${BackendUrl}/prompt/refresh/${sandboxId}`, {
                    method: 'POST',
                    headers: token ? {
                        'Authorization': `Bearer ${token}`
                    } : {}
                });
            } catch (error) {
                console.error('Failed to send sandbox heartbeat:', error);
            }
        };

        sendHeartbeat();

        intervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [sandboxId]);
}
