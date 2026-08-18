import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('\n=== SUPPORT REQUESTS DATA ===\n');
    
    // Count support requests
    const supportCount = await prisma.platformSupportRequest.count();
    console.log(`Total support requests: ${supportCount}`);
    
    if (supportCount > 0) {
      console.log('\nSupport requests details:');
      const support = await prisma.platformSupportRequest.findMany({
        include: {
          messages: true,
          school: { select: { id: true, name: true, country: true } }
        }
      });
      
      support.forEach((req, idx) => {
        console.log(`\n${idx + 1}. ${req.subject}`);
        console.log(`   ID: ${req.id}`);
        console.log(`   Status: ${req.status}`);
        console.log(`   Priority: ${req.priority}`);
        console.log(`   School: ${req.school?.name || 'None'}`);
        console.log(`   Created: ${req.createdAt.toLocaleDateString()}`);
        console.log(`   Messages: ${req.messages.length}`);
        if (req.messages.length > 0) {
          req.messages.forEach((msg, msgIdx) => {
            console.log(`     ${msgIdx + 1}. ${msg.senderRole} - ${msg.senderName}: ${msg.body.substring(0, 50)}...`);
          });
        }
      });
    } else {
      console.log('\n⚠️  NO SUPPORT REQUESTS IN DATABASE');
    }

    console.log('\n=== PLATFORM SUPPORT MESSAGES DATA ===\n');
    const messageCount = await prisma.platformSupportMessage.count();
    console.log(`Total support messages: ${messageCount}`);

    console.log('\n=== EMAIL LOGS DATA ===\n');
    const emailLogCount = await prisma.emailLog.count();
    console.log(`Total email logs: ${emailLogCount}`);
    
    if (emailLogCount > 0) {
      const emails = await prisma.emailLog.findMany({
        select: {
          id: true,
          schoolId: true,
          school: { select: { name: true } },
          recipientEmail: true,
          emailType: true,
          subject: true,
          sentAt: true,
          status: true
        },
        orderBy: { sentAt: 'desc' },
        take: 5
      });
      
      console.log('\nLatest email logs:');
      emails.forEach((email, idx) => {
        console.log(`${idx + 1}. ${email.emailType} - ${email.subject}`);
        console.log(`   To: ${email.recipientEmail}`);
        console.log(`   School: ${email.school?.name || 'N/A'}`);
        console.log(`   Status: ${email.status}`);
        console.log(`   Sent: ${new Date(email.sentAt).toLocaleDateString()}`);
      });
    } else {
      console.log('⚠️  NO EMAIL LOGS IN DATABASE');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
