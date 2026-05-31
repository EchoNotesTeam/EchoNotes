package jobs

import (
	"sync"
)

type ProgressEvent struct {
	JobID   string `json:"job_id"`
	Stage   string `json:"stage"`
	Pct     int    `json:"pct"`
	Message string `json:"message,omitempty"`
	Done    bool   `json:"done,omitempty"`
	Failed  bool   `json:"failed,omitempty"`
	SheetID string `json:"sheet_id,omitempty"`
}

type Subscriber struct {
	Ch     chan ProgressEvent
	closed bool
	mu     sync.Mutex
}

func (s *Subscriber) Send(e ProgressEvent) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	select {
	case s.Ch <- e:
	default:
	}
}

func (s *Subscriber) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.closed {
		s.closed = true
		close(s.Ch)
	}
}

type PubSub struct {
	mu          sync.RWMutex
	subscribers map[string][]*Subscriber
}

func NewPubSub() *PubSub {
	return &PubSub{
		subscribers: make(map[string][]*Subscriber),
	}
}

func (ps *PubSub) Subscribe(jobID string) *Subscriber {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	sub := &Subscriber{Ch: make(chan ProgressEvent, 32)}
	ps.subscribers[jobID] = append(ps.subscribers[jobID], sub)
	return sub
}

func (ps *PubSub) Unsubscribe(jobID string, sub *Subscriber) {
	ps.mu.Lock()
	defer ps.mu.Unlock()
	sub.Close()
	subs := ps.subscribers[jobID]
	for i, s := range subs {
		if s == sub {
			ps.subscribers[jobID] = append(subs[:i], subs[i+1:]...)
			break
		}
	}
	if len(ps.subscribers[jobID]) == 0 {
		delete(ps.subscribers, jobID)
	}
}

func (ps *PubSub) Publish(jobID string, event ProgressEvent) {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	for _, sub := range ps.subscribers[jobID] {
		sub.Send(event)
	}
}
