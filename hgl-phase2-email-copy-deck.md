# HGL Portal — Phase 2 Email Copy Deck

**Version:** 1.0 · July 5, 2026 · Companion to hgl-portal-master-spec.md (v2)
**Conventions:** `{curlyBraces}` = template variables. `[Button label] → destination` = CTA buttons. Pronoun-conditional templates use the pattern `{isStudent ? "you" : studentFirstName}` — parent send renders third person, student send renders second person. Footer types: **T** = transactional (address block, footer text, no unsubscribe link) · **R** = relationship (address block + marketing opt-out link).

---

## #0-P — Registration Confirmation (parent)

**Audience:** parent · **Trigger:** instant on `checkout.session.completed` · **From:** info@ · **Footer:** T
**Subject:** Order Confirmed — {className}
**Preheader:** {studentFirstName} is registered. Here's what happens next.

Hi {parentFirstName},

Thanks for registering! Your class registration with Higher Ground Learning is confirmed.

We'll be in touch with you in the days before the first day of class with all the relevant information that you'll need! This includes diagnostic test information, instructor information, and course room location (for both in-person and online classes).

*Did you register for 1-on-1 tutoring?* The 1-on-1 tutoring sessions are best used after the group class is completed. We'll be in touch with you after the course is done in order to schedule these sessions. If you'd like to schedule them now, that's okay too; just reply to this email with some general time frames when you're available so that we can propose a schedule.

If you have any questions between now and then, you can respond to this email (but maybe check our [FAQs](https://highergroundlearning.com/faqs#general) first).

**Order Summary**
{className} — {price}
Amount paid: {amountPaid} · {paymentDate}
*(+ tutoring add-on line item if purchased)*

**Registration Details**
Student: {studentFirstName} {studentLastName}
Student email: {studentEmail}
School: {schoolName}
Graduating year: {gradYear}
Testing accommodations: {accommodations}
Previous test scores: {previousScores}
Notes: {notes}

---

## #0-S — Registration Confirmation (student)

**Audience:** student · **Trigger:** instant on `checkout.session.completed` · **From:** info@ · **Footer:** T
**Subject:** {schoolNickname} {classType} - you're in!
**Preheader:** See you on {firstSessionDate}

Or is it "your in"? "Yore inn"?

…If you don't know, don't worry. We'll teach you!

If you do know, great! We'll teach you a lot of other things, too. 🙂

**{studentFirstName}, this is just a quick note to let you know that you have been registered for the {schoolNickname} {classType} class starting on {firstSessionDate}.**

In the days before the course starts, you'll receive the necessary course information, such as classroom location and information to access your initial diagnostic test.

(By the way, that test is due {diagnosticDueDate}!)

Until then, you might be interested in signing up for our free [College Prep Compass](http://hgl.co/college-prep-compass), which goes over:

- Practice problems with quick tips to tackle them,
- How you can get the most out of the class,
- How to best take advantage of your free 30-minute strategy session,
- Common misconceptions and FAQs about the test,
- Which schools are test optional (and what's the difference between test optional and test blind),
- What to do about test anxiety,
- and more.

Either way, we'll see you in class!

P.S. Here's what other students have had to say about the class:

"I am extremely excited to tell you that I got my best EVER score (better than any practice test) and I improved by 180 points. I GOT A 1500!!!! I got 8 wrong in reading, 1 wrong in writing, and 3 wrong in math! I wanted to thank you for everything that you've done for me and all the help you have given me with this test. I would not have been able to do this without your help. I hope you keep teaching students just like you taught me, because you are probably one of the best teachers I have ever had."
—Gonzalo Dominguez, Madrid Spain

"This course helped me a lot to prepare for the SAT. The course as a whole focuses on giving tips and strategies for the SAT. Also, weekly practice tests are done to test your skills and make you a more personalized preparation and experience. In the end, I increased by 140 points on the real SAT! A very enriching experience. Recommend it 100%"
—Lucia de la Hoz, Bogotá Colombia

"Best decision I made for my children's college preparation!!! Their ACT scores went from 27 and 28 to 32 and 34!!!!"
—Kirsten McNeal, Salt Lake City USA

---

## PR1 — Payment Reminder 1

**Audience:** parent · **Trigger:** ~2h after registration while `Pending` · **From:** info@ · **Footer:** T
**Subject:** {studentFirstName}'s registration for {schoolNickname} {classType} isn't confirmed yet
**Preheader:** Complete your payment to save their place in class

Hi {parentFirstName},

We saw that you filled out the registration form for {studentFirstName} for the {schoolNickname} {classType} class but didn't proceed to complete payment and confirm their registration. If that was on purpose, no worries – {studentFirstName} is welcome to register any time until the upcoming registration deadline if you change your mind.

If you *did* intend to register for the class, we'd like to kindly ask you to complete the registration by making the payment here:

**[Finalize Registration]** → {resumePaymentLink}

P.S. Do you have a question about the class? It's probably answered in our FAQs here:

[General](https://highergroundlearning.com/faqs#general) · [Diagnostic tests](https://highergroundlearning.com/faqs#diagnostic-tests) · [Attendance](https://highergroundlearning.com/faqs#attendance) · [1-on-1 tutoring](https://highergroundlearning.com/faqs#1on1)

---

## PR2 — Payment Reminder 2

**Audience:** parent · **Trigger:** ~24h while `Pending` · **From:** info@ · **Footer:** T
**Subject:** {studentFirstName}'s registration for {schoolNickname} {classType} isn't confirmed yet
**Preheader:** Complete your payment to save their place in class

Hi {parentFirstName},

Just circling back — {studentFirstName}'s registration for the {schoolNickname} {classType} class is still waiting on payment to be confirmed.

If you paused because you had a question, that's completely reasonable — most answers are in our FAQs below, and for anything else, you can simply reply to this email and a real human will get back to you.

If you're ready to go, it takes about a minute:

**[Finalize Registration]** → {resumePaymentLink}

P.S. FAQs: [General](https://highergroundlearning.com/faqs#general) · [Diagnostic tests](https://highergroundlearning.com/faqs#diagnostic-tests) · [Attendance](https://highergroundlearning.com/faqs#attendance) · [1-on-1 tutoring](https://highergroundlearning.com/faqs#1on1)

---

## PR3 — Payment Reminder 3

**Audience:** parent · **Trigger:** ~3d while `Pending` · **From:** info@ · **Footer:** T
**Subject:** {studentFirstName}'s registration for {schoolNickname} {classType} isn't confirmed yet
**Preheader:** Complete your payment to save their place in class

Hi {parentFirstName},

Quick nudge: {studentFirstName}'s spot in {schoolNickname} {classType} is still reserved but unconfirmed. One minute finishes it:

**[Finalize Registration]** → {resumePaymentLink}

---

## PR4 — Payment Reminder 4 (final)

**Audience:** parent · **Trigger:** ~6d while `Pending`; enrollment → `Expired` at {expiryDate} · **From:** info@ · **Footer:** T
**Subject:** Last reminder: {studentFirstName}'s {schoolNickname} {classType} registration expires soon
**Preheader:** After {expiryDate}, the spot returns to the pool.

Hi {parentFirstName},

This is our last reminder — {studentFirstName}'s registration for the {schoolNickname} {classType} class will **expire on {expiryDate}**, and the spot will go back into the pool.

If you'd still like to register, there's time:

**[Finalize Registration]** → {resumePaymentLink}

And if plans changed, no action needed — the registration will simply expire on its own, and {studentFirstName} is welcome back anytime while spots remain.

Higher Ground Learning

---

## #1 — Parent Thank-You

**Audience:** parent · **Trigger:** ~3h after payment · **From:** William Thomas <billy@> · **Footer:** R
**Subject:** Thank you, {parentFirstName}
**Preheader:** We're looking forward to working with {studentFirstName}

Hi {parentFirstName},

You registered {studentFirstName} for the {schoolNickname} {classType} class and I just wanted to take a moment to reach out to you to say thank you.

There are a lot of ways that you can choose to invest in {studentFirstName}'s future, and we're really honored that you've chosen Higher Ground Learning as one of them.

Getting ready for university can be a challenging time for students, so by registering {studentFirstName} for our class you've given them one less thing to worry about.

I know that, personally, I never would have even gone to university if it weren't for one person...

My amazing mom.

I certainly wouldn't have gone on to earn a Master's degree and definitely wouldn't be here right now, writing you this email.

We don't take lightly the chance to work with {studentFirstName} and to help them achieve their best score on the test. And we really appreciate your vote of confidence in us.

So here's what happens next.

In the days before the course starts, you and {studentFirstName} will receive the necessary course information, such as classroom location and diagnostic test access.

By the way, you might be interested in [College Prep Compass](http://hgl.co/college-prep-compass), where we send out useful information to help you along in this process:

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

"My wife and I would like to thank you for the excellent support that Higher Ground Learning gave to our son in his preparation for the SAT test. From a 1260 at the first practice test, he reached 1400 at the official test. This should be more than enough to enter his first choice university." —Walter Michelini, Italy

"After his sessions, he wrote the SAT twice more, improving dramatically each time and his second score was a 1590. He loved the sessions as they worked on so much more than just the actual content – talking and learning about confidence in exam technique and about manifesting a good outcome. This had a wonderful impact on his approach to exams in general. I would recommend Higher Ground without reservation. Thanks again for a superb experience!!" —Elise Malherbe, South Africa

"We initially worked with HGL to help my son with his SAT test prep. Beyond just teaching my son how to improve, Eric was a great mentor who legitimately cared about my son's interests and activities. Through this bond, Eric was able to push my son to invest in test prep and ultimately achieve a score good enough for any elite university." —Parent of Stanford '25 & '26, USA

---

## #9 — Tutoring Upsell (conditional)

**Audience:** parent · **Trigger:** ~24h after payment, ONLY if enrollment has no tutoring add-on · **From:** William Thomas <billy@> · **Footer:** R, custom text: "Don't want to receive emails like this? We're sorry. This is actually the only one like it that we're planning to send to you." + opt-out link
**Subject:** We didn't want you to miss this
**Preheader:** A lot of people don't notice it

Hi {parentFirstName},

This is definitely not for every student. But so many people miss it and ask about it later when the discount is gone... so here's a quick reminder:

After the {schoolNickname} {classType} class ends, a great way for {studentFirstName} to get even *bigger* point gains is through specialized 1-on-1 tutoring.

Our 1-on-1 tutoring sessions are tailored to overcome {studentFirstName}'s specific weaknesses, exploit {studentFirstName}'s strengths, and refine strategies that are specific to {studentFirstName}'s situation. These sessions work in tandem with the group course, and are perfect for students who are taking the test multiple times, reaching for exceptionally high scores, or facing unique challenges.

Spots always go quickly after the class ends, so we offer a discount and priority scheduling to parents who register early.

*If you know that {studentFirstName} is going to keep studying after the {schoolNickname} {classType} class ends, now is the best time to get these discounted 1-on-1 tutoring hours.*

**[{pkg1Hours} hours — save {pkg1Savings}]** · **[{pkg2Hours} hours — save {pkg2Savings}]** · **[{pkg3Hours} hours — save {pkg3Savings}]** → {addonLink}

These savings are only available before class starts!

Higher Ground Learning

*(Savings computed from tutoring_packages; {addonLink} honors pre_class pricing until {firstSessionDate}, then auto-expires.)*

---

## #2-P — Diagnostic Test Access (parent)

**Audience:** parent · **Trigger:** 10 days before first session, 8:00 AM school-local · **From:** info@ · **Footer:** T
**Subject:** Important {schoolNickname} {classType} diagnostic test information
**Preheader:** Here's how to access the first practice test.

*(Hero photo of HGL space retained. Header nav links: Access Diagnostic Tests · Course Calendar.)*

Hi {parentFirstName},

The first full length remote diagnostic test for {studentFirstName} is now available. The exam is broken into two parts:

- Reading & Writing
- Math

For a more realistic test experience, we strongly recommend that {studentFirstName} complete Part 1 (Reading & Writing), followed by Part 2 (Math) immediately afterward. The instructor will talk about the test during the first class session and will use students' results to tailor the course content and pace, so {studentFirstName} should complete the test by {diagnosticDueDate}, the day before the first class.

**To get started, just click the button below and then click "register." Quickly provide some basic info, and you'll be ready to access the test on our online testing system.**

Invested in {studentFirstName}'s success,

Higher Ground Learning

**[Access the first diagnostic test]** → {synapGroupLink}
**[Download the course calendar]** → {calendarLink}

---

## #2-S — Diagnostic Test (student)

**Audience:** student · **Trigger:** 10 days before first session, 8:00 AM school-local · **From:** info@ · **Footer:** T
**Subject:** Your {classType} diagnostic test is ready
**Preheader:** Finish it by {diagnosticDueDate} — here's how to get in.

Hi {studentFirstName},

Your first diagnostic test is ready. It's in two parts — Reading & Writing, then Math — and for the most realistic practice, do them back-to-back in one sitting.

**Deadline: {diagnosticDueDate}** (the day before your first class). Your instructor uses the results to shape the course, so this one matters.

To get in: click the button below, hit **"register,"** and provide some quick basic info. That creates your account on our testing platform and unlocks the test.

**[Take the diagnostic test]** → {synapGroupLink}

See you in class,
Higher Ground Learning

---

## #3 — VFAQs

**Audience:** both (pronoun rendering in sign-off only) · **Trigger:** 7 days before, 8:00 AM · **From:** info@ · **Footer:** R (original MailerLite footer voice: "Sorry if this was annoying, but please don't unsubscribe yet because we're still planning to send you at least one more important communication about the class." + opt-out)
**Subject:** {schoolNickname} {classType} – here are some VFAQs
**Preheader:** You know, VERY Frequently Asked Questions

Hey {recipientFirstName},

The {schoolNickname} {classType} class is just around the corner, so I want to give you some key information to keep in mind. Below are some VFAQs (Very Frequently Asked Questions):

**What time are classes scheduled?**
All classes are held from {classTime}. You can download the full calendar of class dates [here]({calendarLink}).

**Does enrolling in this course also register me for the {examName}?**
NO. You must register for official exams through the {isSAT ? "[College Board Website](https://www.collegeboard.org)" : "[ACT Website](https://www.act.org)"}. *(Conditional on class_type: SAT Prep → College Board; ACT Prep → act.org; other → generic "the official testing organization's website".)*

**What's the exact location for the class?**
We don't have that information confirmed just yet, but we'll write you again when we know!

Are you still here? You are? Okay, here are a few regular FAQs, just for you:

**I didn't receive the diagnostic test link or information. What should I do?**
Actually we emailed this information to you very recently. Search your inbox and spam folders for an email titled "Important diagnostic test information."

**What is the 30-minute strategy session? And when can I schedule it?**
Each student receives one strategy session with enrollment, during which the instructor will help you craft an individualized study and review plan, build a perfect test-day mindset, understand your diagnostic score report, or go over day-of test strategies.

The strategy sessions usually work best when they're done after the first week of classes, at the earliest. During the first class sessions, you can approach the instructor directly to find and schedule a time during the following week that's mutually agreeable. If you'd like to or need to do the strategy session earlier, however, just let us know and we can try to arrange it.
*(Note: original said "perfect SAT mindset" — generalized to "perfect test-day mindset" so it works for ACT classes. Revert if preferred.)*

**I'm going to miss a class, show up late, and/or leave early. What should I do?**
Check with your instructor to get the lesson plan, materials, and homework. You can follow-up with the instructor afterward if you have any questions about the material.

All online class sessions are recorded and shared with students after the class ends. Again, you can follow-up with the instructor afterward if you have any questions about the material.

If you've signed up for 1-on-1 tutoring, you can also use this time to go over any lessons that you missed.

P.S. In case you have a question that wasn't answered here, here are even more course FAQs:

[General](https://highergroundlearning.com/faqs#general) · [Diagnostic tests](https://highergroundlearning.com/faqs#diagnostic-tests) · [Attendance](https://highergroundlearning.com/faqs#attendance) · [1-on-1 tutoring](https://highergroundlearning.com/faqs#1on1)

Invested in {isStudent ? "your" : studentFirstName + "'s"} success,

Higher Ground Learning

---

## #4 — Class Details ("It's almost class time.")

**Audience:** both (pronoun rendering) · **Trigger:** 4 days before, 8:00 AM · **HOLD + alert admin if {instructorName} or {classroom} blank** · **From:** info@ · **Footer:** T (footer text: "We're still planning to send you a few more important communications about the class.")
**Subject:** {schoolNickname} {classType} Reminder
**Preheader:** Class starts soon! Open to see where classes will be held.

*(Hero photo retained. Header nav: Access Diagnostic Tests · Course Calendar.)*

# It's almost class time.

Hi {recipientFirstName},

I think you already know, but just in case...

The {schoolNickname} {classType} class {isStudent ? "" : "for " + studentFirstName} is coming up soon! (The first day is {firstSessionDate} from {classTime}.)

The instructor will be {instructorName}, and **all classes will take place here: {classroom}**. *(Online classes: {classroom} renders as the meeting link.)*

We're looking forward to seeing {isStudent ? "you" : studentFirstName} in class!

All the best,

Higher Ground Learning

P.S. If {isStudent ? "you haven't" : studentFirstName + " hasn't"} found a moment to take the diagnostic test yet, {isStudent ? "you" : "they"} can still do so by clicking below. If {isStudent ? "you have" : "they have"} already completed the test, no need to let us know. We surely have it.

**[Access Diagnostic Tests]** → {synapGroupLink}

---

## #5 — Location Reminder ("Class starts soon!")

**Audience:** both (pronoun rendering) · **Trigger:** 1 day before, 11:00 AM school-local · **From:** info@ · **Footer:** T (footer text: "You received this email because you signed up for a class that starts really soon and we didn't want you to miss it.")
**Subject:** Classroom location for {schoolNickname} {classType}
**Preheader:** Open up to see where to go for class.

# Class starts soon!
*Like, really soon.*

Hey {recipientFirstName},

Sorry for so many messages, but we really wanted to make sure that {isStudent ? "you don't" : studentFirstName + " doesn't"} miss the first day of {schoolNickname} {classType}!

So here you go...one last reminder: the first day of class is {firstSessionDate} from {classTime}.

**All classes take place here: {classroom}** *(Online classes: renders as the meeting link.)*

Looking forward to seeing {isStudent ? "you" : studentFirstName} in class!

P.S. If {isStudent ? "you still haven't" : studentFirstName + " still hasn't"} taken the first diagnostic test, don't worry. It's still available [here]({synapGroupLink}).

---

## #6 — 2nd Diagnostic Reminder

**Audience:** both (pronoun rendering) · **Trigger:** 7 days after first session, 8:00 AM · **From:** info@ · **Footer:** R
**Subject:** 2nd Diagnostic Reminder for {schoolNickname} {classType}
**Preheader:** Taking practice tests leads to better scores.

Dear {recipientFirstName},

I sincerely hope that {isStudent ? "you have" : studentFirstName + " has"} been taking advantage of {isStudent ? "your" : "their"} class time with {instructorName} to the fullest.

As a friendly reminder, there is still one more diagnostic test {isStudent ? "for you" : "for " + studentFirstName} to take!

Just like before, {isStudent ? "you" : studentFirstName} can click [here]({synapGroupLink}) to login to our online testing platform and access the test.

Kind regards,

Higher Ground Learning

---

## #7 — Review Request

**Audience:** parent · **Trigger:** 1 day after final session, 8:00 AM · **From:** William Thomas <billy@> · **Footer:** R (footer text: "...we're a small company and we have a theory that a nice review from someone like you could really help us to help more students." + opt-out)
**Subject:** How did the {schoolNickname} {classType} class go?
**Preheader:** Tell us how we did — it genuinely helps.

Hi again {parentFirstName},

Now that the {schoolNickname} {classType} class has wrapped up, {studentFirstName} should be feeling a lot more confident and ready to do their best on the exam!

Congrats to {studentFirstName} for their hard work and commitment to improvement.

{parentFirstName}, I know it's a lot to ask, but if you have something nice to say and you don't mind publicly sharing it, we'd be really grateful if you could leave us a review here:

https://g.page/highergroundlearning/review?gm

Thanks in advance if you can spare a few minutes!

To {studentFirstName}'s bright future,

William Thomas

**[Tell us how you feel]** → https://g.page/highergroundlearning/review?gm

---

## #8 — Post-Class Tutoring Offer

**Audience:** both (same copy to both) · **Trigger:** 4 days after final session, 8:00 AM · **From:** William Thomas <billy@> · **Footer:** R (footer text: "You received this email because we genuinely thought it might interest you. You could always unsubscribe.")
**Subject:** Discounted 1-on-1 Tutoring for students who took the {schoolNickname} {classType} Class
**Preheader:** Keep {studentFirstName}'s momentum going before test day.

*(Hero photo retained. Header nav: Discounted Tutoring · Leave us a review.)*

Hello again {recipientFirstName}!

I hope that the recent {classType} class with {instructorName} was useful for {studentFirstName} (and maybe even a little bit fun).

The idea behind our classes is that {studentFirstName} should now have the tools they need to be successful on the test. Of course, we know that some students will continue to study and refine their skills for a future test.

With that in mind, we offer students who have completed one of our classes discounted 1-on-1 tutoring hours. We don't expect that this option is appropriate for all students, but we provide it as a service in case {studentFirstName} wants to continue studying with us.

**You can access discounted tutoring at [highergroundprep.com/discount](https://highergroundprep.com/discount) by using the password BESTSCORE.**

If you sign up, we'll get input from {instructorName} to make sure that {studentFirstName}'s transition from the class to live online tutoring is seamless and they don't lose any momentum with their test prep before the real test.

We'll also get in touch with you and/or {studentFirstName} to make sure that the sessions are timed perfectly for whenever you need them to be.

If you have any questions, feel free to respond to this email!

In {studentFirstName}'s corner, as always,

William

**[Get your discounted tutoring hours]** → https://highergroundprep.com/discount

---

## W1 — Waitlist Confirmation

**Audience:** parent · **Trigger:** instant on joining waitlist · **From:** info@ · **Footer:** T
**Subject:** You're on the waitlist for {schoolNickname} {classType}
**Preheader:** {studentFirstName} is #{waitlistPosition} in line — here's how this works.

Hi {parentFirstName},

The {schoolNickname} {classType} class is currently full — but {studentFirstName} is officially on the waitlist, at position **#{waitlistPosition}**.

Here's how it works: spots occasionally open up (plans change, they really do), and when one does, we offer it to the next family in line. If that's you, you'll get an email with a registration link, and you'll have **48 hours** to complete registration and payment before the spot moves to the next person.

Nothing to do right now — we'll be in touch the moment a spot opens. No payment has been taken and you're under no obligation.

Questions in the meantime? Just reply to this email.

Higher Ground Learning

---

## W2 — Spot Available

**Audience:** parent · **Trigger:** spot opens (expiry/refund/capacity raise); FCFS; admin CC'd · **From:** info@ · **Footer:** T
**Subject:** A spot just opened in {schoolNickname} {classType} 🎉
**Preheader:** It's {studentFirstName}'s if you want it — you have 48 hours.

Hi {parentFirstName},

Good news — a spot just opened up in the {schoolNickname} {classType} class, and {studentFirstName} is next in line.

**The spot is yours if you complete registration by {claimDeadline}.** After that, we'll need to offer it to the next family on the waitlist — so don't sit on this one too long!

**[Claim {studentFirstName}'s spot]** → {claimLink}

A quick recap: the class starts {firstSessionDate}, {classTime}. Once you register, you'll receive all the usual course information — diagnostic test access, location details, and everything else — in the days before class starts. If registration happens close to the start date, we'll send you everything you need right away.

If your plans have changed and you no longer need the spot, no action needed — it'll pass to the next family automatically after the deadline.

Higher Ground Learning

---

## SU — Schedule Update

**Audience:** both · **Trigger:** start date, classroom, or instructor changes after #4 has sent · **From:** info@ · **Footer:** T
**Subject:** Schedule update for {schoolNickname} {classType}
**Preheader:** One or two details have changed — here's the latest.

Hi {recipientFirstName},

A quick update about the {schoolNickname} {classType} class — some details have changed since our last email, and we want to make sure you have the latest:

{changesBlock}
*(Rendered as a list of only what changed, e.g.: **First day of class:** now {firstSessionDate} · **Location:** now {classroom} · **Instructor:** now {instructorName})*

Everything else stays the same. The full up-to-date schedule is always here: **[View the class calendar]** → {calendarLink} *(and if you subscribed to the calendar, it's already updated automatically).*

Sorry for any shuffling — see you in class!

Higher Ground Learning

---

## ⚠️ Open items in this deck

1. **#3 strategy-session answer** — original said "perfect SAT mindset"; generalized here to "perfect test-day mindset" for ACT compatibility. Revert if preferred.
2. **Late-registration combined welcome email** — behavior specified (thank-you + Synap + FAQ content merged) but body not yet drafted. Draft when Code implements the trigger, or assemble from #1 + #2 + #3 blocks.
3. **Internal admin emails** (hold-and-alert, weekly digest, min-enrollment, waitlist rollover) — plain-text functional copy, fine for Code to draft; no brand voice needed.

*(Resolved July 5: both collapsed FAQ answers inserted; all four FAQ URLs inserted; #0-P subject/preheader confirmed; exam-registration FAQ made conditional on class_type.)*
