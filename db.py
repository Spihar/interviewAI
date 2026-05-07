from supabase import create_client, Client
import os
from dotenv import load_dotenv

load_dotenv()

url: str = os.getenv("SUPABASE_URL")
key: str = os.getenv("SUPABASE_KEY")
# We load the Supabase URL and API key from environment variables using the dotenv library.

supabase: Client = create_client(url, key)
# We create a Supabase client instance using the create_client function, 
# which allows us to interact with our Supabase database throughout our application.