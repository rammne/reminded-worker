## This is a background worker for RemindED. This is where the LLM process happens. <br/> It follows a queue-based design (FIFO) where we process 5 jobs per minute based on the Queue.
### *Please document all bugs, especially about RPM and TPM limits.*
---
# to run this worker run the commands below, in order:
- npm install
- npm run build *This will create a dist folder*
- node dist/index.js

### *make sure to create .env.local and ensure that all necessary required keys are added.*
