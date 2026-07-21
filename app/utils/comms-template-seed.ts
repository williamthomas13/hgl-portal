// Feature A4 seed data (docs/COMMS_ATTENDANCE_PARENT_SPEC.md §A4 migration):
// the approved Phase 2 copy deck (docs/EMAIL_COPY.md v1.0), transcribed into
// the template markdown dialect as version 1 of every template. Seeding is
// idempotent (skips templates that already exist — never overwrites edits).
// Templates go live one by one AFTER test-send verification, not here.

export type TemplateSeed = {
  template_key: string
  display_name: string
  sequence_number: string | null
  audience: 'parent' | 'student' | 'both'
  from_identity: 'info' | 'billy'
  category: 'transactional' | 'relationship'
  subject: string
  preheader: string
  footer_note: string | null
  body_markdown: string
}

export const TEMPLATE_SEEDS: TemplateSeed[] = [
  {
    template_key: 'E0_CONFIRM_PARENT',
    display_name: '#0-P — Registration confirmation (parent)',
    sequence_number: '0-P',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: 'Order Confirmed — {className}',
    preheader: "{studentFirstName} is registered. Here's what happens next.",
    footer_note: null,
    body_markdown: `Hi {parentFirstName},

Thanks for registering! Your class registration with Higher Ground Learning is confirmed.

We'll be in touch with you in the days before the first day of class with all the relevant information that you'll need! This includes diagnostic test information, instructor information, and {classLocationPhrase}.

{addonTutoringBlock}

If you have any questions between now and then, you can respond to this email (but maybe check our [FAQs](https://highergroundlearning.com/faqs#general) first).

{orderSummaryBlock}

{registrationDetailsBlock}

[button:View your registration]({portalLink})`,
  },
  {
    template_key: 'E0_CONFIRM_STUDENT',
    display_name: '#0-S — Registration confirmation (student)',
    sequence_number: '0-S',
    audience: 'student',
    from_identity: 'info',
    category: 'transactional',
    subject: "{className} - you're in!",
    preheader: 'See you on {firstSessionDate}',
    footer_note: null,
    body_markdown: `Or is it "your in"? "Yore inn"?

…If you don't know, don't worry. We'll teach you!

If you do know, great! We'll teach you a lot of other things, too. 🙂

**{studentFirstName}, this is just a quick note to let you know that you have been registered for the {className} class starting on {firstSessionDate}.**

In the days before the course starts, you'll receive the necessary course information, such as {classLocationPhrase} and information to access your initial diagnostic test.

(By the way, that test is due {diagnosticDueDate}!)

Until then, you might be interested in signing up for our free [College Prep Compass]({compassLink}), which goes over:

- Practice problems with quick tips to tackle them,
- How you can get the most out of the class,
- How to best take advantage of your free 30-minute strategy session,
- Common misconceptions and FAQs about the test,
- Which schools are test optional (and what's the difference between test optional and test blind),
- What to do about test anxiety,
- and more.

Either way, we'll see you in class!

P.S. Here's what other students have had to say about the class:

> "I am extremely excited to tell you that I got my best EVER score (better than any practice test) and I improved by 180 points. I GOT A 1500!!!! I got 8 wrong in reading, 1 wrong in writing, and 3 wrong in math! I wanted to thank you for everything that you've done for me and all the help you have given me with this test. I would not have been able to do this without your help. I hope you keep teaching students just like you taught me, because you are probably one of the best teachers I have ever had."
> —Gonzalo Dominguez, Madrid Spain

> "This course helped me a lot to prepare for the SAT. The course as a whole focuses on giving tips and strategies for the SAT. Also, weekly practice tests are done to test your skills and make you a more personalized preparation and experience. In the end, I increased by 140 points on the real SAT! A very enriching experience. Recommend it 100%"
> —Lucia de la Hoz, Bogotá Colombia

> "Best decision I made for my children's college preparation!!! Their ACT scores went from 27 and 28 to 32 and 34!!!!"
> —Kirsten McNeal, Salt Lake City USA`,
  },
  {
    template_key: 'PR1',
    display_name: 'PR1 — Payment reminder (2h)',
    sequence_number: 'PR1',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: "{studentFirstName}'s registration for {className} isn't confirmed yet",
    preheader: 'Complete your payment to save their place in class',
    footer_note: null,
    body_markdown: `Hi {parentFirstName},

We saw that you filled out the registration form for {studentFirstName} for the {className} class but didn't proceed to complete payment and confirm their registration. If that was on purpose, no worries – {studentFirstName} is welcome to register any time until the upcoming registration deadline if you change your mind.

If you *did* intend to register for the class, we'd like to kindly ask you to complete the registration by making the payment here:

[button:Finalize Registration]({resumePaymentLink})

P.S. Do you have a question about the class? It's probably answered in our FAQs here:

{faqLinks}`,
  },
  {
    template_key: 'PR2',
    display_name: 'PR2 — Payment reminder (24h)',
    sequence_number: 'PR2',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: "{studentFirstName}'s registration for {className} isn't confirmed yet",
    preheader: 'Complete your payment to save their place in class',
    footer_note: null,
    body_markdown: `Hi {parentFirstName},

Just circling back — {studentFirstName}'s registration for the {className} class is still waiting on payment to be confirmed.

If you paused because you had a question, that's completely reasonable — most answers are in our FAQs below, and for anything else, you can simply reply to this email and a real human will get back to you.

If you're ready to go, it takes about a minute:

[button:Finalize Registration]({resumePaymentLink})

P.S. FAQs: {faqLinks}`,
  },
  {
    template_key: 'PR3',
    display_name: 'PR3 — Payment reminder (72h)',
    sequence_number: 'PR3',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: "{studentFirstName}'s registration for {className} isn't confirmed yet",
    preheader: 'Complete your payment to save their place in class',
    footer_note: null,
    body_markdown: `Hi {parentFirstName},

Quick nudge: {studentFirstName}'s spot in {className} is still reserved but unconfirmed. One minute finishes it:

[button:Finalize Registration]({resumePaymentLink})`,
  },
  {
    template_key: 'PR4',
    display_name: 'PR4 — Payment reminder (final)',
    sequence_number: 'PR4',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: "Last reminder: {studentFirstName}'s {className} registration expires soon",
    preheader: 'After {expiryDate}, the spot returns to the pool.',
    footer_note: null,
    body_markdown: `Hi {parentFirstName},

This is our last reminder — {studentFirstName}'s registration for the {className} class will **expire on {expiryDate}**, and the spot will go back into the pool.

If you'd still like to register, there's time:

[button:Finalize Registration]({resumePaymentLink})

And if plans changed, no action needed — the registration will simply expire on its own, and {studentFirstName} is welcome back anytime while spots remain.

Higher Ground Learning`,
  },
  {
    template_key: 'E1_THANKS',
    display_name: '#1 — Thank you',
    sequence_number: '1',
    audience: 'parent',
    from_identity: 'billy',
    category: 'relationship',
    subject: 'Thank you, {parentFirstName}',
    preheader: "We're looking forward to working with {studentFirstName}",
    footer_note: null,
    body_markdown: `Hi {parentFirstName},

You registered {studentFirstName} for the {className} class and I just wanted to take a moment to reach out to you to say thank you.

There are a lot of ways that you can choose to invest in {studentFirstName}'s future, and we're really honored that you've chosen Higher Ground Learning as one of them.

Getting ready for university can be a challenging time for students, so by registering {studentFirstName} for our class you've given them one less thing to worry about.

I know that, personally, I never would have even gone to university if it weren't for one person...

My amazing mom.

I certainly wouldn't have gone on to earn a Master's degree and definitely wouldn't be here right now, writing you this email.

We don't take lightly the chance to work with {studentFirstName} and to help them achieve their best score on the test. And we really appreciate your vote of confidence in us.

So here's what happens next.

In the days before the course starts, you and {studentFirstName} will receive the necessary course information, such as {classLocationPhrase} and diagnostic test access.

By the way, you might be interested in [College Prep Compass]({compassLink}), where we send out useful information to help you along in this process:

- How {studentFirstName} can get the most out of the class,
- How to best take advantage of the free 30-minute strategy session,
- Common misconceptions and FAQs about the test,
- Which schools are test optional (and what's the difference between test optional and test blind),
- What to do about test anxiety,
- and more.

By choosing to help {studentFirstName} prepare for this test, you've made a great investment in {studentFirstName}'s growth and future opportunities. We're humbled to be part of the journey, so thanks again.

See you soon!

To {studentFirstName}'s success,

William Thomas
President, Higher Ground Learning

P.S. Here's what some other parents have said about our classes:

> "My wife and I would like to thank you for the excellent support that Higher Ground Learning gave to our son in his preparation for the SAT test. From a 1260 at the first practice test, he reached 1400 at the official test. This should be more than enough to enter his first choice university." —Walter Michelini, Italy

> "After his sessions, he wrote the SAT twice more, improving dramatically each time and his second score was a 1590. He loved the sessions as they worked on so much more than just the actual content – talking and learning about confidence in exam technique and about manifesting a good outcome. This had a wonderful impact on his approach to exams in general. I would recommend Higher Ground without reservation. Thanks again for a superb experience!!" —Elise Malherbe, South Africa

> "We initially worked with HGL to help my son with his SAT test prep. Beyond just teaching my son how to improve, Eric was a great mentor who legitimately cared about my son's interests and activities. Through this bond, Eric was able to push my son to invest in test prep and ultimately achieve a score good enough for any elite university." —Parent of Stanford '25 & '26, USA`,
  },
  {
    template_key: 'E9_UPSELL',
    display_name: '#9 — Pre-class tutoring upsell',
    sequence_number: '9',
    audience: 'parent',
    from_identity: 'billy',
    category: 'relationship',
    subject: "We didn't want you to miss this",
    preheader: "A lot of people don't notice it",
    footer_note:
      "Don't want to receive emails like this? We're sorry. This is actually the only one like it that we're planning to send to you.",
    body_markdown: `Hi {parentFirstName},

This is definitely not for every student. But so many people miss it and ask about it later when the discount is gone... so here's a quick reminder:

After the {className} class ends, a great way for {studentFirstName} to get even *bigger* point gains is through specialized 1-on-1 tutoring.

Our 1-on-1 tutoring sessions are tailored to overcome {studentFirstName}'s specific weaknesses, exploit {studentFirstName}'s strengths, and refine strategies that are specific to {studentFirstName}'s situation. These sessions work in tandem with the group course, and are perfect for students who are taking the test multiple times, reaching for exceptionally high scores, or facing unique challenges.

Spots always go quickly after the class ends, so we offer a discount and priority scheduling to parents who register early.

*If you know that {studentFirstName} is going to keep studying after the {className} class ends, now is the best time to get these discounted 1-on-1 tutoring hours.*

{upsellPackagesBlock}

These savings are only available before class starts!

Higher Ground Learning`,
  },
  {
    template_key: 'E2_DIAG_PARENT',
    display_name: '#2-P — Diagnostic & Synap access (parent)',
    sequence_number: '2-P',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: 'Important {className} diagnostic test information',
    preheader: "Here's how to access the first practice test.",
    footer_note: null,
    body_markdown: `Hi {parentFirstName},

The first full length remote diagnostic test for {studentFirstName} is now available. The exam is broken into two parts:

- Reading & Writing
- Math

For a more realistic test experience, we strongly recommend that {studentFirstName} complete Part 1 (Reading & Writing), followed by Part 2 (Math) immediately afterward. The instructor will talk about the test during the first class session and will use students' results to tailor the course content and pace, so {studentFirstName} should complete the test by {diagnosticDueDate}, the day before the first class.

**To get started, just click the button below and then click "register." Quickly provide some basic info, and you'll be ready to access the test on our online testing system.**

Invested in {studentFirstName}'s success,

Higher Ground Learning

[button:Access the first diagnostic test]({synapGroupLink})

[button:Download the course calendar]({calendarLink})`,
  },
  {
    template_key: 'E2_DIAG_STUDENT',
    display_name: '#2-S — Diagnostic & Synap access (student)',
    sequence_number: '2-S',
    audience: 'student',
    from_identity: 'info',
    category: 'transactional',
    subject: 'Your {classType} diagnostic test is ready',
    preheader: "Finish it by {diagnosticDueDate} — here's how to get in.",
    footer_note: null,
    body_markdown: `Hi {studentFirstName},

Your first diagnostic test is ready. It's in two parts — Reading & Writing, then Math — and for the most realistic practice, do them back-to-back in one sitting.

**Deadline: {diagnosticDueDate}** (the day before your first class). Your instructor uses the results to shape the course, so this one matters.

To get in: click the button below, hit **"register,"** and provide some quick basic info. That creates your account on our testing platform and unlocks the test.

[button:Take the diagnostic test]({synapGroupLink})

See you in class,
Higher Ground Learning`,
  },
  {
    template_key: 'E3_VFAQ',
    display_name: '#3 — Video FAQs',
    sequence_number: '3',
    audience: 'both',
    from_identity: 'info',
    category: 'relationship',
    subject: '{className} – here are some VFAQs',
    preheader: 'You know, VERY Frequently Asked Questions',
    footer_note:
      "Sorry if this was annoying, but please don't unsubscribe yet because we're still planning to send you at least one more important communication about the class.",
    body_markdown: `Hey {recipientFirstName},

The {className} class is just around the corner, so I want to give you some key information to keep in mind. Below are some VFAQs (Very Frequently Asked Questions):

**What time are classes scheduled?**
All classes are held from {classTime}. You can download the full calendar of class dates [here]({calendarLink}).

**Does enrolling in this course also register me for the {examName}?**
NO. You must register for official exams through the {examRegistrationLink}.

**What's the exact location for the class?**
We don't have that information confirmed just yet, but we'll write you again when we know!

Are you still here? You are? Okay, here are a few regular FAQs, just for you:

**What if I didn't get the diagnostic test information?**
No problem — you can get to it right here: [button:Take the diagnostic test]({synapGroupLink}). It's due {diagnosticDueDate}, the day before your first class. (It also went to your inbox, so it's worth a search of your spam folder for next time.)

**What is the 30-minute strategy session? And when can I schedule it?**
Each student receives one strategy session with enrollment, during which the instructor will help you craft an individualized study and review plan, build a perfect test-day mindset, understand your diagnostic score report, or go over day-of test strategies.

The strategy sessions usually work best when they're done after the first week of classes, at the earliest. During the first class sessions, you can approach the instructor directly to find and schedule a time during the following week that's mutually agreeable. If you'd like to or need to do the strategy session earlier, however, just let us know and we can try to arrange it.

**I'm going to miss a class, show up late, and/or leave early. What should I do?**
Check with your instructor to get the lesson plan, materials, and homework. You can follow-up with the instructor afterward if you have any questions about the material.

All online class sessions are recorded and shared with students after the class ends. Again, you can follow-up with the instructor afterward if you have any questions about the material.

If you've signed up for 1-on-1 tutoring, you can also use this time to go over any lessons that you missed.

P.S. In case you have a question that wasn't answered here, here are even more course FAQs:

{faqLinks}

Invested in {your_or_names} success,

Higher Ground Learning`,
  },
  {
    template_key: 'E4_CLASS_DETAILS',
    display_name: '#4 — Class details',
    sequence_number: '4',
    audience: 'both',
    from_identity: 'info',
    category: 'transactional',
    subject: '{className} Reminder',
    preheader: 'Class starts soon! Open to see where classes will be held.',
    footer_note: "We're still planning to send you a few more important communications about the class.",
    body_markdown: `# It's almost class time.

Hi {recipientFirstName},

I think you already know, but just in case...

The {className} class {for_name_or_blank}is coming up soon! (The first day is {firstSessionDate} from {classTime}.)

The instructor will be {instructorName}, and **all classes will take place here: {classroom}**.

We're looking forward to seeing {you_or_name} in class!

All the best,

Higher Ground Learning

P.S. If {you_havent_or_name_hasnt} found a moment to take the diagnostic test yet, {you_or_they} can still do so by clicking below. If {you_have_or_they_have} already completed the test, no need to let us know. We surely have it.

[button:Access Diagnostic Tests]({synapGroupLink})`,
  },
  {
    template_key: 'E5_LOCATION',
    display_name: '#5 — Location reminder',
    sequence_number: '5',
    audience: 'both',
    from_identity: 'info',
    category: 'transactional',
    subject: 'Classroom location for {className}',
    preheader: 'Open up to see where to go for class.',
    footer_note:
      "You received this email because you signed up for a class that starts really soon and we didn't want you to miss it.",
    body_markdown: `# Class starts soon!

*Like, really soon.*

Hey {recipientFirstName},

Sorry for so many messages, but we really wanted to make sure that {you_dont_or_name_doesnt} miss the first day of {className}!

So here you go...one last reminder: the first day of class is {firstSessionDate} from {classTime}.

**All classes take place here: {classroom}**

Looking forward to seeing {you_or_name} in class!

P.S. If {you_still_havent_or_name_still_hasnt} taken the first diagnostic test, don't worry. It's still available [here]({synapGroupLink}).`,
  },
  {
    template_key: 'E6_DIAG2',
    display_name: '#6 — Second diagnostic',
    sequence_number: '6',
    audience: 'both',
    from_identity: 'info',
    category: 'relationship',
    subject: '2nd Diagnostic Reminder for {className}',
    preheader: 'Taking practice tests leads to better scores.',
    footer_note: null,
    body_markdown: `Dear {recipientFirstName},

I sincerely hope that {you_have_or_name_has} been taking advantage of {your_or_their} class time with {instructorName} to the fullest.

As a friendly reminder, there is still one more diagnostic test {for_you_or_for_name} to take!

Just like before, {you_or_name} can click [here]({synapGroupLink}) to login to our online testing platform and access the test.

Kind regards,

Higher Ground Learning`,
  },
  {
    template_key: 'E7_REVIEW',
    display_name: '#7 — Review request',
    sequence_number: '7',
    audience: 'parent',
    from_identity: 'billy',
    category: 'relationship',
    subject: 'How did the {className} class go?',
    preheader: 'Tell us how we did — it genuinely helps.',
    footer_note:
      "...we're a small company and we have a theory that a nice review from someone like you could really help us to help more students.",
    body_markdown: `Hi again {parentFirstName},

Now that the {className} class has wrapped up, {studentFirstName} should be feeling a lot more confident and ready to do their best on the exam!

Congrats to {studentFirstName} for their hard work and commitment to improvement.

{parentFirstName}, I know it's a lot to ask, but if you have something nice to say and you don't mind publicly sharing it, we'd be really grateful if you could leave us a review here:

[{reviewLink}]({reviewLink})

Thanks in advance if you can spare a few minutes!

To {studentFirstName}'s bright future,

William Thomas

[button:Tell us how you feel]({reviewLink})`,
  },
  {
    template_key: 'E8_POSTCLASS_TUTORING',
    display_name: '#8 — Post-class tutoring offer',
    sequence_number: '8',
    audience: 'both',
    from_identity: 'billy',
    category: 'relationship',
    subject: 'Discounted 1-on-1 Tutoring for students who took the {className} Class',
    preheader: "Keep {studentFirstName}'s momentum going before test day.",
    footer_note:
      'You received this email because we genuinely thought it might interest you. You could always unsubscribe.',
    body_markdown: `Hello again {recipientFirstName}!

I hope that the recent {classType} class with {instructorName} was useful for {studentFirstName} (and maybe even a little bit fun).

The idea behind our classes is that {studentFirstName} should now have the tools they need to be successful on the test. Of course, we know that some students will continue to study and refine their skills for a future test.

With that in mind, we offer students who have completed one of our classes discounted 1-on-1 tutoring hours. We don't expect that this option is appropriate for all students, but we provide it as a service in case {studentFirstName} wants to continue studying with us.

**You can access discounted tutoring at [highergroundprep.com/discount]({discountLink}) by using the password BESTSCORE.**

If you sign up, we'll get input from {instructorName} to make sure that {studentFirstName}'s transition from the class to live online tutoring is seamless and they don't lose any momentum with their test prep before the real test.

We'll also get in touch with you and/or {studentFirstName} to make sure that the sessions are timed perfectly for whenever you need them to be.

If you have any questions, feel free to respond to this email!

In {studentFirstName}'s corner, as always,

William

[button:Get your discounted tutoring hours]({discountLink})`,
  },
  {
    template_key: 'W1_WAITLIST',
    display_name: 'W1 — Waitlist confirmation',
    sequence_number: 'W1',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: "You're on the waitlist for {className}",
    preheader: "{studentFirstName} is #{waitlistPosition} in line — here's how this works.",
    footer_note: null,
    body_markdown: `Hi {parentFirstName},

The {className} class is currently full — but {studentFirstName} is officially on the waitlist, at position **#{waitlistPosition}**.

Here's how it works: spots occasionally open up (plans change, they really do), and when one does, we offer it to the next family in line. If that's you, you'll get an email with a registration link, and you'll have **48 hours** to complete registration and payment before the spot moves to the next person.

Nothing to do right now — we'll be in touch the moment a spot opens. No payment has been taken and you're under no obligation.

Questions in the meantime? Just reply to this email.

Higher Ground Learning`,
  },
  {
    template_key: 'W2_SPOT_OPEN',
    display_name: 'W2 — Waitlist spot open',
    sequence_number: 'W2',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: 'A spot just opened in {className} 🎉',
    preheader: "It's {studentFirstName}'s if you want it — you have 48 hours.",
    footer_note: null,
    body_markdown: `Hi {parentFirstName},

Good news — a spot just opened up in the {className} class, and {studentFirstName} is next in line.

**The spot is yours if you complete registration by {claimDeadline}.** After that, we'll need to offer it to the next family on the waitlist — so don't sit on this one too long!

[button:Claim {studentFirstName}'s spot]({claimLink})

A quick recap: the class starts {firstSessionDate}, {classTime}. Once you register, you'll receive all the usual course information — diagnostic test access, location details, and everything else — in the days before class starts. If registration happens close to the start date, we'll send you everything you need right away.

If your plans have changed and you no longer need the spot, no action needed — it'll pass to the next family automatically after the deadline.

Higher Ground Learning`,
  },
  {
    template_key: 'SU_SCHEDULE_UPDATE',
    display_name: 'SU — Schedule update',
    sequence_number: 'SU',
    audience: 'both',
    from_identity: 'info',
    category: 'transactional',
    subject: 'Schedule update for {className}',
    preheader: "One or two details have changed — here's the latest.",
    footer_note: null,
    body_markdown: `Hi {recipientFirstName},

A quick update about the {className} class — some details have changed since our last email, and we want to make sure you have the latest:

{changesBlock}

Everything else stays the same. The full up-to-date schedule is always here:

[button:View the class calendar]({calendarLink})

*(And if you subscribed to the calendar, it's already updated automatically.)*

Sorry for any shuffling — see you in class!

Higher Ground Learning`,
  },
  {
    template_key: 'LR_WELCOME',
    display_name: 'LR — Late-registration welcome',
    sequence_number: 'LR',
    audience: 'both',
    from_identity: 'info',
    category: 'transactional',
    subject: "You're in — and here's everything you need for {className}",
    preheader: 'Class starts {firstSessionDate}. One thing to do first.',
    footer_note: null,
    body_markdown: `Hi {recipientFirstName},

{youre_or_name_is} registered for the {className} class — and since the class starts **{firstSessionDate}**, here's everything you need in one email.

**1. The diagnostic test — this one's time-sensitive.**
{Your_or_names} first diagnostic test is ready now. It's in two parts (Reading & Writing, then Math), best done back-to-back in one sitting. The instructor uses the results to shape the course, so please complete it **before the first class** if at all possible.

To get in: click below, hit "register," and provide some quick basic info.

[button:Take the diagnostic test]({synapGroupLink})

**2. When and where.**
Classes run {classTime}. {classDetailsBlock}

Full schedule:

[button:View the class calendar]({calendarLink})

**3. Good things to know.**
Quick answers to the most common questions — class times, what to do if {you_miss_or_name_misses} a session, the free 30-minute strategy session — are in our [FAQs](https://highergroundlearning.com/faqs#general).

Any other questions, just reply to this email. See you in class — soon!

Higher Ground Learning

{orderSummaryBlock}

{registrationDetailsBlock}`,
  },

  // ---------------------------------------------------------------------------
  // PL-13 registry pass: cancellation (CX/CX-W) + tutoring T-series. These
  // seed as DRAFTS (live=false) — the code-rendered twins keep sending until
  // each is test-sent and flipped live in the editor, per the A4 ramp.
  // ---------------------------------------------------------------------------
  {
    template_key: 'CX_FAMILY',
    display_name: 'CX — Class cancellation (families)',
    sequence_number: 'CX',
    audience: 'both',
    from_identity: 'billy',
    category: 'transactional',
    subject: 'IMPORTANT: {className} Course Cancellation',
    footer_note: null,
    preheader: "The class won't run — here are your options, including a full refund.",
    body_markdown: `Hi {recipientFirstName},

Unfortunately, I'm writing with a bit of bad news: we were unable to meet the minimum number of students required to offer the {className} class that {you_or_name} signed up for. As a result, we've unfortunately had to cancel the course. I understand that this cancellation can be worrisome, and I sincerely apologize for the inconvenience.

{cancellationOptionsBlock}

Best,

William Thomas
Higher Ground Learning`,
  },
  {
    template_key: 'CX_WAITLIST',
    display_name: 'CX-W — Cancellation note (waitlisted families)',
    sequence_number: 'CX-W',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: 'Update on the {className} waitlist',
    footer_note: null,
    preheader: "The class won't run this term — no action needed.",
    body_markdown: `Hi {parentFirstName},

A quick update: the {className} class that {studentFirstName} was waitlisted for won't be running this term, so the waitlist is closed. No payment was ever taken and there's nothing you need to do.

You're still on our list — the moment a new {schoolNickname} {classType} course opens, you'll be the first to know. Nothing to do on your end.

Sorry it didn't work out this time!

Higher Ground Learning`,
  },
  {
    template_key: 'T1_MONTHLY_PROPOSAL',
    display_name: 'T1 — Monthly schedule proposal',
    sequence_number: 'T1',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: "{studentNames}'s tutoring schedule for {tutoringMonthLabel}",
    footer_note: null,
    preheader: '{tutoringMonthLabel} schedule — confirm or request changes',
    body_markdown: `## {studentNames}'s {tutoringMonthLabel} tutoring schedule

Here's the plan for {tutoringMonthLabel} — same as always unless you'd like a change:

{scheduleBlock}

{monthTotalLine}

{packageNote}

[button:Confirm schedule]({confirmOneTapLink})

[Request changes →]({confirmLink})

If we don't hear from you within {autoconfirmDays} days, the schedule confirms automatically and stays exactly as shown — same as our usual policy (schedule changes for the coming month need to reach us before month-end).

{contactBlock}`,
  },
  {
    template_key: 'T1B_PROPOSAL_NUDGE',
    display_name: 'T1b — Proposal nudge',
    sequence_number: 'T1b',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: "Reminder: {studentNames}'s {tutoringMonthLabel} tutoring schedule",
    footer_note: null,
    preheader: 'One click to confirm {tutoringMonthLabel}',
    body_markdown: `## Quick reminder — {tutoringMonthLabel} schedule

We sent over {studentNames}'s {tutoringMonthLabel} tutoring schedule a couple of days ago. If it looks right, one click confirms it; if not, tell us what to change.

[button:Review the schedule]({confirmLink})

No action needed to keep everything as-is — the schedule confirms automatically in {daysLeft} days.

{contactBlock}`,
  },
  {
    template_key: 'T2_INVOICE',
    display_name: 'T2 — Monthly invoice',
    sequence_number: 'T2',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: '{invoiceReminderPrefix}Your HGL tutoring invoice for {tutoringMonthLabel} — {invoiceTotal}',
    footer_note: null,
    preheader: '{invoiceTotal} due by {invoiceDueDate}',
    body_markdown: `## {tutoringMonthLabel} tutoring invoice

{invoiceIntroBlock}

[button:View & pay invoice]({invoiceUrl})

Pay by card or directly from a US bank account (ACH) — both options are on the invoice page.

{autopayBlock}

{contactBlock}`,
  },
  {
    template_key: 'T3_SCHEDULE_CHANGE',
    display_name: 'T3 — Schedule change confirmation',
    sequence_number: 'T3',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: "{studentFirstName}'s tutoring schedule changed",
    footer_note: null,
    preheader: "Change to {studentFirstName}'s tutoring",
    body_markdown: `## Schedule change confirmed

Here's what changed for {studentFirstName}:

{changeListBlock}

The tutor's calendar is already updated. If this doesn't look right, just say so and we'll fix it.

{contactBlock}`,
  },
  {
    template_key: 'T4_PAYMENT_FAILED',
    display_name: 'T4 — Payment failed',
    sequence_number: 'T4',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: 'Payment issue — {tutoringMonthLabel} tutoring invoice',
    footer_note: null,
    preheader: '{tutoringMonthLabel} payment needs attention',
    body_markdown: `## We couldn't process your payment

{paymentFailBlock}

{payButtonBlock}

{contactBlock}`,
  },
  {
    template_key: 'T7_INTAKE_REQUEST',
    display_name: 'T7 — Intake form request',
    sequence_number: 'T7',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: "A few quick questions before {studentFirstName}'s tutoring starts",
    footer_note: null,
    preheader: "Five minutes, one page, no login — and you're set.",
    body_markdown: `Hi {parentFirstName},

We're excited to get started! To match {studentFirstName}'s tutor well and keep everything running smoothly, we just need a few details — the same questions we'd otherwise trade over a week of emails, all on one page.

It takes about five minutes, works on a phone, and there's nothing to print, scan, or sign in to:

[button:Fill out the intake form]({intakeFormLink})

We'll ask about scheduling availability, what {studentFirstName} is working toward, and the practical bits (emergency contact, anything we should know). Your answers come straight to us.

{contactBlock}`,
  },
  {
    template_key: 'T8_WELCOME_HANDOFF',
    display_name: 'T8 — Welcome / handoff',
    sequence_number: 'T8',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: "Welcome! {studentFirstName}'s {tutoringSubject} tutoring with {tutorFirstName}",
    footer_note: null,
    preheader: '{studentFirstName} + {tutorFirstName}: schedule, policies, and everything else.',
    body_markdown: `## Welcome aboard!

Hi {parentFirstName},

{studentFirstName} is all set for 1-on-1 {tutoringSubject} tutoring with **{tutorName}**. Here's everything in one place.

{tutorContactLine}

{locationBlock}

{scheduleBlock}

**One thing we need:** please read and accept our scheduling & billing policies (two minutes, one click):

[button:Read & accept the policies]({agreementsLink})

**The one rule worth remembering:** with 24+ hours' notice, rescheduling a session is always free — inside 24 hours the prepaid session is forfeited or carries a $40/hour reschedule fee, because {tutorFirstName} is still paid for the reserved time.

Prefer not to think about invoices? [Set up autopay]({autopayLink}) and each month's confirmed invoice charges your saved card or bank account automatically.

{contactBlock}`,
  },

  // ---------------------------------------------------------------------------
  // PL-40/PL-41 session-setup comms (copy APPROVED July 19, 2026). These send
  // FROM the configurable tutoring contact (PL-50) at the send site; the
  // from_identity field here is not used for them.
  // ---------------------------------------------------------------------------
  {
    template_key: 'T_SCHEDULE_CONFIRM',
    display_name: 'Schedule confirm — approval request',
    sequence_number: null,
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: "Please confirm {studentFirstName}'s tutoring schedule",
    preheader: 'One quick tap to lock in the times.',
    footer_note: null,
    body_markdown: `Hi {parentFirstName},

We'd like to set {studentFirstName} up for regular 1-on-1 tutoring with {tutorName}. Here's the schedule we have in mind:

**{scheduleSummary}**

If that works, just confirm and we'll lock it in and add it to your calendar:

[button:Confirm this schedule]({approveLink})

Prefer different times, or have a question? Reply to this email or reach us — we're happy to adjust before anything's set.

{contactBlock}`,
  },
  {
    template_key: 'T_SCHEDULE_CONFIRM_NUDGE',
    display_name: 'Schedule confirm — nudge',
    sequence_number: null,
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: "Still holding {studentFirstName}'s tutoring times",
    preheader: 'Just need a quick confirm when you have a moment.',
    footer_note: null,
    body_markdown: `Hi {parentFirstName},

Just circling back on {studentFirstName}'s proposed tutoring schedule with {tutorName}:

**{scheduleSummary}**

A quick tap confirms it and we'll add it to your calendar:

[button:Confirm this schedule]({approveLink})

If the times don't quite work, reply and we'll find something better.

{contactBlock}`,
  },
  {
    template_key: 'T_SCHEDULE_SET',
    display_name: 'Schedule set — welcome / all-set',
    sequence_number: null,
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: "{studentFirstName}'s tutoring schedule is all set",
    preheader: "Here's the plan, plus calendar links so it's always in front of you.",
    footer_note: null,
    body_markdown: `Hi {parentFirstName},

Great news — {studentFirstName}'s 1-on-1 tutoring with {tutorName} is all set up. Here's the regular plan:

**{scheduleSummary}**

A couple of things to make life easier:

[button:Add to your calendar]({calendarLink}) — subscribe once and every session (and any future change) shows up automatically.

[button:Download the schedule (PDF)]({schedulePdfLink})

You can reschedule any single session yourself from your parent portal — no need to email us for the small stuff. And if the regular time ever needs to change, just reach out and we'll take care of it.

We're looking forward to working with {studentFirstName}.

{contactBlock}`,
  },

  // ---------------------------------------------------------------------------
  // PL-53c: the audience-aware #8 fork — families who already bought add-on
  // hours get "time to put your hours to work", never the discount pitch.
  // Sent from the configured tutoring contact (PL-50) at the send site.
  // ---------------------------------------------------------------------------
  {
    template_key: 'E8_ADDON_SCHEDULING',
    display_name: '#8b — Add-on hours: time to schedule',
    sequence_number: '8b',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: "Time to put {studentFirstName}'s tutoring hours to work",
    preheader: "{hoursRemaining} hours ready — let's get {studentFirstName} scheduled.",
    footer_note: null,
    body_markdown: `Hi {parentFirstName},

Now that the {className} class has wrapped up, this is the moment {studentFirstName}'s 1-on-1 tutoring is built for — a tutor can pick up exactly where the class left off, focused on what {studentFirstName} needs next.

**You have {hoursRemaining} tutoring hours ready to use.**

{schedulingCtaBlock}

{contactBlock}`,
  },
  {
    template_key: 'E8_ADDON_NUDGE',
    display_name: '#8b-n — Add-on hours nudge',
    sequence_number: '8b-n',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: "{studentFirstName}'s tutoring hours are waiting when you are",
    preheader: "No rush — just don't let good hours gather dust.",
    footer_note: null,
    body_markdown: `Hi {parentFirstName},

Just a gentle reminder that {studentFirstName} still has **{hoursRemaining} tutoring hours** ready to use — no rush, and they don't expire on you.

Whenever you're ready, [share {studentFirstName}'s availability]({availabilityLink}) and we'll propose times — or just reply and we'll sort it out together.

{contactBlock}`,
  },

  // ---------------------------------------------------------------------------
  // PL-54c: interest-list notify — drained by the admin "N families are
  // waiting" prompt when a matching class opens. From info@.
  // ---------------------------------------------------------------------------
  {
    template_key: 'NW_NEXT_CLASS_OPEN',
    display_name: 'NW — Next class open (interest list)',
    sequence_number: 'NW',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: 'A new {schoolNickname} {classType} class just opened',
    preheader: 'You asked us to tell you first — here it is.',
    footer_note: null,
    body_markdown: `Hi {parentFirstName},

You asked us to let you know when the next {schoolNickname} {classType} course opened — it's open now:

{classSummaryLine}

[button:See details & register]({registrationLink})

Spots fill in order of registration, so don't wait too long.

{contactBlock}`,
  },

  // ---------------------------------------------------------------------------
  // PL-59: waitlist release when a class completes still-full — the case
  // CX-W never covered. Fires from the class-completion transition; those
  // families also join the PL-54 interest list. From info@.
  // ---------------------------------------------------------------------------
  {
    template_key: 'WR_WAITLIST_RELEASE',
    display_name: 'WR — Waitlist release (class completed full)',
    sequence_number: 'WR',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: 'An update on {schoolNickname} {classType} — and an option for {studentFirstName}',
    preheader: "We couldn't open a spot — but we can still help right away.",
    footer_note: null,
    body_markdown: `Hi {parentFirstName},

An update on {schoolNickname} {classType}: the class stayed full, and we weren't able to open up a place for {studentFirstName}. No payment was ever taken, and I'm sorry it didn't work out this time.

If {studentFirstName} still wants to get ready, we can help right away with **1-on-1 tutoring** — the same prep, tailored entirely to {studentFirstName}, scheduled around your family. [Share your availability]({availabilityLink}) and we'll propose times, or just reply and we'll talk it through.

And either way, you're still on our list — the moment a new {schoolNickname} {classType} course opens, you'll be the first to know. Nothing to do on your end.

{contactBlock}`,
  },

  // ---------------------------------------------------------------------------
  // PL-63: agreements — the first policies ask and its automatic chase.
  // The chase runs +3d / +7d after the first ask (T8 or a manual send from
  // /admin/agreements) and stops the moment the family accepts.
  // ---------------------------------------------------------------------------
  {
    template_key: 'AG_REQUEST',
    display_name: 'AG — Agreement request (policies)',
    sequence_number: 'AG',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: 'One quick thing: our scheduling & billing policies',
    preheader: "Two-minute read, one click — and it's done.",
    footer_note: null,
    body_markdown: `Hi {parentFirstName},

Before (or as) tutoring gets underway, we ask every family to read and accept our scheduling & billing policies — how monthly billing works, the 24-hour reschedule rule, that sort of thing. It's a two-minute read and one click to accept:

[button:Read & accept the policies]({agreementsLink})

One important note: we can't start {studentFirstName}'s sessions until this is signed — it takes about two minutes, and it protects your family as much as it protects us.

You'll get a copy of exactly what you accepted, and we keep one too — no forms to print or return.

{contactBlock}`,
  },
  {
    template_key: 'AG_NUDGE',
    display_name: 'AG-N — Agreement nudge (automatic chase)',
    sequence_number: 'AG-N',
    audience: 'parent',
    from_identity: 'info',
    category: 'transactional',
    subject: 'A quick reminder: our policies still need your OK',
    preheader: 'Two minutes, one click — then sessions can start.',
    footer_note: null,
    body_markdown: `Hi {parentFirstName},

Just a nudge — our scheduling & billing policies are still waiting for your OK, and we can't start {studentFirstName}'s sessions until they're signed. It takes about two minutes, and it protects your family as much as it protects us:

[button:Read & accept the policies]({agreementsLink})

Already accepted them? Then our systems are just catching up — you can ignore this.

{contactBlock}`,
  },
]
