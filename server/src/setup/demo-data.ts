import * as bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { certificateNumber, invoiceNumber, staffNumber, studentNumber, verificationCode } from "../common/codes";

/**
 * Example content for the staging site and local development: courses, classes, a teacher,
 * students, invoices, FAQ, news and exam dates — enough to click through every screen.
 * Never run against the live database (the seed command refuses when APP_ENV=production).
 */
export async function loadDemoData(prisma: PrismaClient, log: (line: string) => void = console.log): Promise<void> {
  if (await prisma.course.count()) {
    log("Demo data skipped: courses already exist.");
    return;
  }
  const year = new Date().getFullYear();
  const today = new Date(new Date().toISOString().slice(0, 10));
  const inDays = (n: number) => new Date(today.getTime() + n * 86400_000);
  const password = await bcrypt.hash("Demo-Password-2026", 12);

  const courses = await Promise.all(
    [
      { title: "German A1 – Beginners", level: "A1", schedule: "Mon, Wed, Fri · 08:00–10:00", fee: 150000, summary: "Start from zero: greetings, numbers, everyday conversations and basic grammar." },
      { title: "German A2 – Elementary", level: "A2", schedule: "Tue, Thu · 14:00–17:00", fee: 170000, summary: "Talk about your life, work and plans; past tense and cases." },
      { title: "German B1 – Intermediate", level: "B1", schedule: "Mon–Thu · 17:30–19:30", fee: 200000, summary: "Independent use of German for study and work; prepares for Goethe-Zertifikat B1." },
      { title: "German B2 – Upper Intermediate", level: "B2", schedule: "Saturdays · 09:00–13:00", fee: 230000, summary: "Fluent discussion, formal writing and exam preparation for study abroad." },
    ].map((c, position) =>
      prisma.course.create({
        data: {
          slug: c.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, ""),
          title: c.title,
          language: "German",
          level: c.level,
          schedule: c.schedule,
          duration: "12 weeks",
          feeText: `MWK ${c.fee.toLocaleString("en-US")} per term`,
          feeAmount: c.fee,
          capacity: 25,
          summary: c.summary,
          body: `${c.summary}\n\nSmall classes, experienced teachers and plenty of speaking practice. Materials are included.`,
          position,
        },
      })
    )
  );

  const teacher = await prisma.staff.create({
    data: { name: "Anna Weber", email: "teacher@demo.heimatliebe.mw", department: "teaching", jobTitle: "German teacher", staffNo: staffNumber(), passwordHash: password },
  });
  await prisma.staff.createMany({
    data: [
      { name: "Grace Phiri", email: "admissions@demo.heimatliebe.mw", department: "admissions", jobTitle: "Admissions officer", staffNo: staffNumber(), passwordHash: password },
      { name: "James Banda", email: "finance@demo.heimatliebe.mw", department: "finance", jobTitle: "Accountant", staffNo: staffNumber(), passwordHash: password },
      { name: "Mary Mwale", email: "director@demo.heimatliebe.mw", department: "director", role: "MANAGER", jobTitle: "Director", staffNo: staffNumber(), passwordHash: password },
    ],
  });

  const classes = await Promise.all(
    courses.slice(0, 3).map((course, i) =>
      prisma.classGroup.create({
        data: {
          name: `${course.level} ${["Morning", "Afternoon", "Evening"][i]} ${year}`,
          courseId: course.id,
          teacherId: teacher.id,
          level: course.level,
          room: `Room ${i + 1}`,
          schedule: course.schedule,
          startDate: inDays(-30),
          endDate: inDays(60),
          timetable: { create: [1, 3, 5].map((dayOfWeek) => ({ dayOfWeek, startTime: ["08:00", "14:00", "17:30"][i], endTime: ["10:00", "17:00", "19:30"][i], room: `Room ${i + 1}` })) },
        },
      })
    )
  );

  const names = ["Chikondi Banda", "Tiyamike Phiri", "Kondwani Mwale", "Thandiwe Nyirenda", "Madalitso Chirwa", "Chisomo Kumwenda", "Limbani Gondwe", "Tadala Msiska", "Yamikani Kaunda", "Dalitso Mhango", "Takondwa Zulu", "Mphatso Nkhoma"];
  for (const [index, name] of names.entries()) {
    const cls = classes[index % classes.length];
    const student = await prisma.student.create({
      data: {
        studentNo: studentNumber(year, index + 1),
        name,
        email: `${name.split(" ")[0].toLowerCase()}@demo.heimatliebe.mw`,
        phone: `+265 99${String(1000000 + index * 7919).slice(0, 7)}`,
        course: "German",
        level: cls.level,
        passwordHash: password,
        enrollments: { create: { classId: cls.id } },
      },
    });
    const paid = index % 3 === 0 ? 150000 : index % 3 === 1 ? 50000 : 0;
    await prisma.invoice.create({
      data: {
        invoiceNo: invoiceNumber(),
        studentId: student.id,
        description: `Term 1 tuition ${year}`,
        amount: 150000,
        paid,
        dueDate: index % 4 === 0 ? inDays(-5) : inDays(20),
        status: paid >= 150000 ? "paid" : paid > 0 ? "partial" : index % 4 === 0 ? "overdue" : "pending",
      },
    });
    for (let d = 1; d <= 10; d++) {
      await prisma.attendance.create({ data: { classId: cls.id, studentId: student.id, date: inDays(-d * 2), status: (index + d) % 9 === 0 ? "absent" : (index + d) % 7 === 0 ? "late" : "present" } });
    }
    if (index < 3) {
      await prisma.certificate.create({ data: { certificateNo: certificateNumber(), verificationCode: verificationCode(), studentId: student.id, holderName: name, course: "German A1", level: "A1", grade: "Good", hours: 120, issuedAt: inDays(-90) } });
    }
  }

  await prisma.assignment.create({
    data: { classId: classes[0].id, title: "Introduce yourself", description: "Write 8–10 sentences introducing yourself in German: name, origin, family, hobbies.", skill: "writing", dueAt: inDays(5), totalPoints: 20 },
  });
  await prisma.exam.create({
    data: {
      classId: classes[0].id,
      title: "A1 Grammar quiz",
      description: "Ten minutes. Choose the correct answer.",
      durationMinutes: 10,
      published: true,
      opensAt: inDays(-1),
      closesAt: inDays(14),
      questions: [
        { id: "q1", type: "choice", prompt: "Ich ___ aus Malawi.", options: ["komme", "kommst", "kommt"], answer: 0, points: 1 },
        { id: "q2", type: "choice", prompt: "Das ist ___ Buch.", options: ["ein", "eine", "einen"], answer: 0, points: 1 },
        { id: "q3", type: "truefalse", prompt: "“Guten Morgen” is said in the evening.", answer: false, points: 1 },
        { id: "q4", type: "short", prompt: "Plural of “das Kind”?", answer: "Kinder|die Kinder", points: 1 },
        { id: "q5", type: "essay", prompt: "Write two sentences about your family.", points: 4 },
      ],
    },
  });

  await prisma.examSession.createMany({
    data: [
      { title: "Goethe-Zertifikat A1: Start Deutsch 1", level: "A1", modules: "Lesen, Hören, Schreiben, Sprechen", examDate: inDays(45), registrationDeadline: inDays(30), venue: "Heimatliebe Institute, Karonga", fee: 95000, capacity: 20 },
      { title: "Goethe-Zertifikat B1", level: "B1", modules: "Lesen, Hören, Schreiben, Sprechen", examDate: inDays(75), registrationDeadline: inDays(55), venue: "Heimatliebe Institute, Karonga", fee: 160000, capacity: 15 },
    ],
  });
  await prisma.calendarEvent.createMany({
    data: [
      { title: "Term 2 begins", type: "term", startDate: inDays(40) },
      { title: "Mid-term break", type: "holiday", startDate: inDays(20), endDate: inDays(24) },
      { title: "Open day — free trial lessons", type: "event", startDate: inDays(10), description: "Visit the institute, meet the teachers and try a free German lesson." },
    ],
  });
  await prisma.faq.createMany({
    data: [
      { question: "Do I need to know any German before starting?", answer: "No. Our A1 course starts from zero. If you already know some German, take the free online placement test to find your level.", position: 1 },
      { question: "How much are the fees?", answer: "Fees depend on the level; you'll find the current fee on each course page. Fees can be paid by Airtel Money, TNM Mpamba or bank transfer.", position: 2 },
      { question: "Can I take the Goethe exam at Heimatliebe?", answer: "We are working towards becoming an accredited exam centre. Upcoming exam dates and registration are on the Exams page.", position: 3 },
      { question: "Are there evening or weekend classes?", answer: "Yes. We run morning, afternoon, evening and Saturday classes, so you can study around work or school.", position: 4 },
    ],
  });
  await prisma.newsPost.create({
    data: { slug: "new-b1-evening-class", title: "New B1 evening class opens", category: "Courses", summary: "Due to demand we are opening a second B1 class in the evenings.", body: "Due to demand we are opening a second B1 class, Monday to Thursday from 17:30. Places are limited — apply online today.", publishedAt: inDays(-3) },
  });
  await prisma.testimonial.createMany({
    data: [
      { name: "Chikondi B.", course: "German B1", body: "The teachers are patient and the classes are fun. I passed my B1 exam and I'm now preparing to study in Germany." },
      { name: "Tiyamike P.", course: "German A2", body: "Learning German at Heimatliebe opened doors I never imagined. The evening classes fit perfectly around my job." },
    ],
  });
  await prisma.externalApp.createMany({
    data: [
      { name: "Google Classroom", url: "https://classroom.google.com", description: "Class materials and homework", icon: "book", audience: "all", position: 1 },
      { name: "Google Drive", url: "https://drive.google.com", description: "Shared documents", icon: "folder", audience: "staff", position: 2 },
      { name: "Google Meet", url: "https://meet.google.com", description: "Online lessons", icon: "video", audience: "all", position: 3 },
      { name: "Deutsche Welle – Learn German", url: "https://learngerman.dw.com", description: "Free courses and exercises", icon: "globe", audience: "students", position: 4 },
    ],
  });
  await prisma.announcement.create({ data: { title: "Welcome to the new portal", body: "Your classes, timetable, homework, results and fees are now all in one place.", audience: "all", pinned: true } });
  await prisma.enquiry.createMany({
    data: [
      { name: "Wezi Nyasulu", phone: "+265 888 123 456", interest: "German A1", message: "When does the next beginners class start?", channel: "whatsapp", nextFollowUp: today },
      { name: "Blessings Mkandawire", email: "blessings@example.com", interest: "Goethe B1 exam", message: "Can I register for the exam without taking the course?", channel: "website" },
    ],
  });
  await prisma.application.create({
    data: { reference: "APP-DEMO2026", name: "Faith Munthali", email: "faith@example.com", phone: "+265 991 000 111", course: courses[0].title, level: "A1", preferredSchedule: "Evening", motivation: "I want to work as a nurse in Germany." },
  });
  log(`Demo data loaded. Demo staff and students sign in with password "Demo-Password-2026" (e.g. teacher@demo.heimatliebe.mw, chikondi@demo.heimatliebe.mw).`);
}
