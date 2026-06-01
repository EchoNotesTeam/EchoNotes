package jobs

import (
	"sync"
	"testing"
	"time"
)

func TestPubSub_PublishDelivered(t *testing.T) {
	ps := NewPubSub()
	sub := ps.Subscribe("job-1")
	defer ps.Unsubscribe("job-1", sub)

	want := ProgressEvent{JobID: "job-1", Stage: "transcribing", Pct: 25}
	ps.Publish("job-1", want)

	select {
	case got := <-sub.Ch:
		if got.JobID != want.JobID || got.Stage != want.Stage || got.Pct != want.Pct {
			t.Fatalf("got %+v, want %+v", got, want)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timed out waiting for event")
	}
}

func TestPubSub_MultipleSubscribers(t *testing.T) {
	ps := NewPubSub()
	sub1 := ps.Subscribe("job-2")
	sub2 := ps.Subscribe("job-2")
	defer ps.Unsubscribe("job-2", sub1)
	defer ps.Unsubscribe("job-2", sub2)

	ev := ProgressEvent{JobID: "job-2", Stage: "done", Pct: 100, Done: true}
	ps.Publish("job-2", ev)

	for _, sub := range []*Subscriber{sub1, sub2} {
		select {
		case got := <-sub.Ch:
			if !got.Done {
				t.Errorf("expected Done=true, got %+v", got)
			}
		case <-time.After(100 * time.Millisecond):
			t.Error("timed out waiting for subscriber to receive event")
		}
	}
}

func TestPubSub_UnsubscribeClosesChannel(t *testing.T) {
	ps := NewPubSub()
	sub := ps.Subscribe("job-3")
	ps.Unsubscribe("job-3", sub)

	// After unsubscribe the channel must be closed.
	select {
	case _, ok := <-sub.Ch:
		if ok {
			t.Fatal("expected channel to be closed")
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("channel was not closed after Unsubscribe")
	}
}

func TestPubSub_PublishToUnknownJobIsNoOp(t *testing.T) {
	ps := NewPubSub()
	// Should not panic
	ps.Publish("nonexistent-job", ProgressEvent{JobID: "nonexistent-job"})
}

func TestPubSub_NonBlockingSendWhenBufferFull(t *testing.T) {
	ps := NewPubSub()
	sub := ps.Subscribe("job-4")
	defer ps.Unsubscribe("job-4", sub)

	// Fill the buffer (capacity 32) without consuming
	for i := range 40 {
		ps.Publish("job-4", ProgressEvent{JobID: "job-4", Pct: i})
	}
	// No panic and no deadlock = success
}

func TestPubSub_ClosedSubscriberIgnoresSend(t *testing.T) {
	ps := NewPubSub()
	sub := ps.Subscribe("job-5")
	// Close manually before publish
	sub.Close()

	// Should not panic on a send to a closed subscriber
	sub.Send(ProgressEvent{JobID: "job-5", Stage: "test"})
}

func TestPubSub_ConcurrentPublish(t *testing.T) {
	ps := NewPubSub()
	sub := ps.Subscribe("job-6")
	defer ps.Unsubscribe("job-6", sub)

	var wg sync.WaitGroup
	for i := range 10 {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			ps.Publish("job-6", ProgressEvent{JobID: "job-6", Pct: n})
		}(i)
	}
	wg.Wait()
	// No race condition = success (run with -race to verify)
}
