from __future__ import annotations

from abc import ABC, abstractmethod

from portfolio_tracker.models import Position


class ProtocolAdapter(ABC):
    protocol_name: str

    @abstractmethod
    def collect_positions(self, wallet_address: str) -> list[Position]:
        raise NotImplementedError
