import type { PrismaClient } from "@prisma/client";

/**
 * The institute's own content carried over from the previous website, loaded once into an empty
 * live database so the new site isn't blank on day one. Staff edit or replace it in the workspace.
 */
export async function loadStarterContent(prisma: PrismaClient, log: (line: string) => void): Promise<void> {
  if ((await prisma.course.count()) || (await prisma.newsPost.count())) return;
  await prisma.course.create({
    data: {
      slug: "beginner-german-a1",
      title: "Beginner German (A1)",
      language: "German",
      level: "A1",
      status: "Enrolling now",
      schedule: "Monday & Wednesday, 5:00 PM – 7:00 PM",
      duration: "3 months",
      feeText: "MWK 200,000 per month",
      feeAmount: 200000,
      summary: "Start your German journey: essential vocabulary, basic grammar, pronunciation and everyday conversation.",
      body:
        "Start your German language journey with our A1 Beginner course, designed for students with little or no prior knowledge of German. You will learn essential vocabulary, basic grammar, pronunciation, and everyday communication skills needed for simple conversations.\n\nBy the end of the course, you will be able to introduce yourself, ask and answer basic questions, understand common expressions, and communicate confidently in everyday situations.\n\n**Schedule:** Monday & Wednesday, 5:00 PM – 7:00 PM\n**Duration:** 3 months\n**Tuition fee:** MWK 200,000 per month",
    },
  });
  await prisma.newsPost.create({
    data: {
      slug: "goethe-examination-arrangements",
      title: "Goethe examination arrangements",
      category: "Announcement",
      summary: "Update on upcoming Goethe examination dates and where students can sit the exams.",
      image: "/uploads/images/goethe.jpeg",
      publishedAt: new Date("2026-06-25T08:11:00.000Z"),
      body:
        "The Institute is currently making inquiries regarding upcoming Goethe examination dates in Tanzania, and new dates have been published on the Goethe website.\n\nAt present, Tanzania remains the Institute's preferred examination location because management is able to coordinate examination arrangements more effectively and has better access to official examination information.\n\nOnce official examination dates and arrangements are confirmed, students and parents will be informed immediately. Parents whose children are preparing for upcoming exams are kindly asked to be prepared financially so payments can be processed without problems once dates are confirmed.\n\nStudents who wish to sit for Goethe examinations in Zimbabwe or anywhere else are free to do so independently, at their own discretion and expense. The Institute will not be responsible for travel, accommodation, examination registration, costs or any other matters relating to examinations taken independently at other centres.",
    },
  });
  // Photos from the previous website (served from public/uploads by the website).
  await prisma.galleryItem.createMany({
    data: [1, 2, 3, 4, 5].map((n) => ({ src: `/uploads/images/nk${n}.jpeg`, caption: "Nkhalo Mlowoka", category: "Classroom", position: n })),
  });
  await prisma.faq.createMany({
    data: [
      { question: "Do I need to know any German before starting?", answer: "No. The A1 course starts from zero. If you already know some German, take the free online placement test to find your level.", position: 1 },
      { question: "How do I pay my fees?", answer: "By Airtel Money, TNM Mpamba or bank transfer. Upload a photo of the confirmation in your student portal, using your student number as the reference.", position: 2 },
      { question: "Where can I sit the Goethe exam?", answer: "See our news and the Exams page for the latest arrangements and dates.", position: 3 },
    ],
  });
  log("Starter content loaded (Beginner German course, Goethe exam notice, FAQ).");
}
