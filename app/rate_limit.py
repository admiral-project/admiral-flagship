# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

"""
Simple in-memory rate limiter for login attempts.
Tracks attempts per IP address within a sliding window.
"""

import time
from collections import defaultdict


class RateLimiter:
    """Rate limiter using sliding window algorithm."""
    
    def __init__(self, max_attempts=5, window_seconds=60):
        """
        Initialize rate limiter.
        
        Args:
            max_attempts: Maximum attempts allowed in window
            window_seconds: Time window in seconds
        """
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self.attempts = defaultdict(list)  # {identifier: [timestamp, ...]}
    
    def is_allowed(self, identifier):
        """
        Check if request is allowed under rate limit.
        
        Args:
            identifier: IP address or user identifier
            
        Returns:
            Tuple of (allowed: bool, remaining_seconds: int)
        """
        now = time.time()
        
        # Clean up old attempts outside the window
        self.attempts[identifier] = [
            t for t in self.attempts[identifier]
            if now - t < self.window_seconds
        ]
        
        # Check if exceeded limit
        if len(self.attempts[identifier]) >= self.max_attempts:
            oldest = self.attempts[identifier][0]
            remaining = int(self.window_seconds - (now - oldest)) + 1
            return False, remaining
        
        # Record new attempt
        self.attempts[identifier].append(now)
        return True, 0
    
    def reset(self, identifier):
        """Reset attempt counter for identifier."""
        self.attempts.pop(identifier, None)
